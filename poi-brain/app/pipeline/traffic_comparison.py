"""Compare explicitly requested snapshots with separate historical traffic context."""
import asyncio
import re

from ..state import STATE
from .camera_analysis import analyze_camera_frame, now_iso
from .geo_services import cached_get

DATA_URL = 'https://data.cityofnewyork.us/resource/7ym2-wayt.json'
SOURCE_URL = 'https://data.cityofnewyork.us/Transportation/Automated-Traffic-Volume-Counts/7ym2-wayt'


def street_aliases(name: str) -> list[str]:
    street = name.split('@')[0].strip().upper()
    street = re.sub(r'\b(\d+)(?:ST|ND|RD|TH)\b', r'\1', street)
    street = re.sub(r'\b(?:STREET)\b', 'ST', street)
    street = re.sub(r'\b(?:AVENUE|AVE)\b', 'AV', street)
    variants = {street}
    if street.endswith(' ST'): variants.add(street[:-3] + ' STREET')
    if street.endswith(' AV'): variants.update({street[:-3] + ' AVENUE', street[:-3] + ' AVE'})
    return sorted(variants)


async def historical_traffic(camera_id: str) -> dict:
    camera = STATE.cameras[camera_id]
    aliases = street_aliases(camera.name)
    quoted = ','.join("'" + name.replace("'", "''") + "'" for name in aliases)
    borough = (camera.borough or 'Manhattan').replace("'", "''")
    rows = await cached_get('nyc-traffic', DATA_URL, {
        '$select': 'street,yr,count(*) as samples,avg(vol) as mean_volume,max(vol) as peak_volume',
        '$where': f"boro='{borough}' AND upper(street) in ({quoted}) AND vol >= 0",
        '$group': 'street,yr', '$order': 'yr DESC, samples DESC', '$limit': 1,
    }, ttl=86400)
    if not rows:
        return {'status':'no_match','source':SOURCE_URL,'detail':'No exact street-name match in the historical traffic-count dataset.'}
    row = rows[0]
    return {'status':'available','street':row['street'],'year':int(row['yr']),
        'samples':int(row['samples']), 'meanVehiclesPer15Minutes':round(float(row['mean_volume']),1),
        'peakVehiclesPer15Minutes':round(float(row['peak_volume']),1), 'source':SOURCE_URL,
        'scope':'Historical 15-minute counter samples across this named street and borough, potentially multiple segments/directions/times. Not necessarily this camera intersection; not live, annual totals, or a direct validation of the snapshot.'}


def comparison_conclusion(results: list[dict]) -> dict:
    levels = {'sparse':1, 'moderate':2, 'dense':3}
    valid = [r for r in results if r.get('trafficAssessment', {}).get('confidence') in ('medium','high') and r['trafficAssessment']['roadOccupancy'] in levels]
    if len(valid) < 2:
        return {'status':'insufficient_evidence', 'cameraIds':[], 'reason':'Fewer than two readable, sufficiently confident snapshots; no comparative winner.'}
    highest = max(levels[r['trafficAssessment']['roadOccupancy']] for r in valid)
    winners = [r['cameraId'] for r in valid if levels[r['trafficAssessment']['roadOccupancy']] == highest]
    return {'status':'tie' if len(winners)>1 else 'sample_leader', 'cameraIds':winners,
        'reason':'Highest observed travel-lane occupancy category among readable snapshots. Vehicle counts are estimates; camera angles differ. Historical counts are context, not a tiebreaker or proof of current throughput.'}


async def compare_traffic(camera_ids: list[str] | None = None) -> dict:
    ids = camera_ids or []
    selection = 'User-selected cameras'
    if not ids:
        selection = 'Illustrative candidates: Canal Street, Broadway near Times Square, and Seventh Avenue. Not an exhaustive citywide search.'
        for phrase in ('canal street @ chrystie', 'broadway @ 45', '7 ave @ 44'):
            match = next((c for c in STATE.cameras.values() if phrase in c.name.lower() and c.snapshotUrl), None)
            if match: ids.append(match.id)
    if not 2 <= len(ids) <= 3 or len(set(ids)) != len(ids) or any(i not in STATE.cameras for i in ids):
        raise ValueError('Choose 2–3 distinct, known cameras with find_cameras to compare traffic.')
    results = []
    started = now_iso()
    try:
        async with asyncio.timeout(120):
            for camera_id in ids:
                record = {'cameraId':camera_id, 'cameraName':STATE.cameras[camera_id].name}
                results.append(record)
                try:
                    result = await analyze_camera_frame(camera_id, purpose='traffic')
                    result.pop('rawResponse', None)
                    record.update(result)
                except Exception as error:
                    record['error'] = str(error)[:250]
                try:
                    record['historicalTraffic'] = await historical_traffic(camera_id)
                except Exception:
                    record['historicalTraffic'] = {'status':'unavailable','source':SOURCE_URL,'detail':'Traffic counts could not be retrieved; no corroborating count is claimed.'}
    except TimeoutError:
        pass
    for camera_id in ids:
        record = next((r for r in results if r['cameraId'] == camera_id), None)
        if record is None:
            results.append({'cameraId':camera_id,'cameraName':STATE.cameras[camera_id].name,'error':'Not sampled within the 120-second comparison budget.'})
        elif not record.get('trafficAssessment') and not record.get('error'):
            record['error'] = 'Analysis did not complete within the comparison budget.'
        if record is not None and not record.get('historicalTraffic'):
            record['historicalTraffic'] = {'status':'unavailable','source':SOURCE_URL,'detail':'Lookup did not complete within the comparison budget.'}
    return {'comparison': {'startedAt':started,'finishedAt':now_iso(),'selection':selection,
        'metric':'Visible vehicle occupancy in sequential snapshots, not traffic flow or pedestrian volume.',
        'results':results,'conclusion':comparison_conclusion(results),
        'coverage':'Only these 2–3 public cameras; no claim of the busiest street in all New York.'},
        'cameras':[{'id':i,'name':STATE.cameras[i].name} for i in ids],
        'source':'NYC DOT camera snapshots + NYC DOT Automated Traffic Volume Counts', 'untrusted':True}
