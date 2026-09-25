# Operations workspace

Open **http://localhost:3000/pages/operations**, or click **OPERATIONS** in the navigation.

This is a separate workspace. The existing Protected, Map, NYC Deck, camera-analysis endpoint, and legacy route solver retain their UI and API behavior. Operations has its own components, route cache, analysis memory and `/api/operations/*` endpoints. It reads the existing camera catalog and historical risk scores. For this limited-GPU demo, the local backend configuration now disables the old automatic camera poller; old pages no longer receive newly generated background observations. Historical map updates continue.

## Demo flow

1. Ask **Find 3 cameras near Times Square**. The assistant calls `find_cameras` through MCP; the results appear as camera links and the map fits the matching locations.
2. Click a camera link, inspect its snapshot, and close the preview. The selected camera remains in assistant context.
3. Ask **Analyze this camera**. A new snapshot is fetched and analyzed. The result includes observation and fetch timestamps. The camera's freshness indicator updates within ten seconds.
4. Ask **Explain the historical risk for this camera**. The response uses source features, not an inference about the current frame.
5. Ask **Plan a route between the cameras you found**. An OSRM road route appears on the map; its card shows the visiting order, distance and estimated travel time.
6. Ask **Which route has more recorded collisions?** The assistant calls `compare_routes`, highlights the selected road route, and explains the comparison. Collision ranking uses the highest count in a visited stop cell, not a collision total along the road. Other examples: **Which suggested route is quickest?**, **Show unit-02**, or **Plan a route between the cameras you found**. Routes are hidden until requested; all route details stay in the Assistant. There is no separate Routes tab.
7. Click **Monitor** beside a camera result, **Start selected camera**, or **Start results** (first three search results). No ID entry is needed. IDs are shown under camera names for optional manual use. You can also ask **Start monitoring one camera near Times Square**. The Monitoring tab shows progress and timestamped observations.
8. Click **Stop monitoring**, or ask **Stop monitoring the zone**. The monitor cancels pending work and schedules no more snapshots. LM Studio may finish an already submitted inference, whose result is discarded. The chat **Stop reply** button cancels only the chat request.
9. Ask **Find the busiest street using camera images and traffic data**. `compare_camera_traffic` samples three illustrative Manhattan candidates sequentially and fetches dated [NYC DOT traffic-volume counts](https://data.cityofnewyork.us/Transportation/Automated-Traffic-Volume-Counts/7ym2-wayt). It reports the highest visible lane occupancy among those samples, or a tie/insufficient evidence. Street-level historical counts may cover different intersections, years and directions; they provide context, not proof of present traffic or a citywide winner.
10. When a monitored frame has a model hazard flag, an amber **Potential hazard — review required** notice appears above the chat and in the Monitoring tab. Review the exact saved frame, fetch/analysis times and model explanation, then click **Acknowledge — reviewed**. No hazard flagged is labeled separately from **Unknown — analysis failed**. Later normal frames and Stop do not clear pending alerts. Acknowledgment records review, not resolution, and monitoring continues.

Enter submits and clears the assistant composer; Shift+Enter adds a line. Stop cancels the conversation request. Already completed results remain visible.

## Grounded answers and citations

The final chat answer is assembled from server-authored facts derived from the current request's tool results; arbitrary generated factual prose is not displayed as the final answer. Successful results are rendered directly so an answer-formatting failure cannot hide retrieved evidence. Recognized comparison questions call the appropriate read-only MCP tool directly, while general requests use local-model tool selection. Without retrieved facts, the model can select only bounded limitation messages, not invent an answer. Each fact has a named inline citation, an explanation of its evidentiary basis, retrieval time, source links where applicable, and an expandable supporting record. App coverage explains what the available data can and cannot establish. Invalid source IDs are never shown as citations.

Image observations remain fallible model interpretations, not verified facts. Snapshot fetch/analysis timestamps are separate from source capture time, and live camera source links may show a newer image. Historical counts do not establish present conditions; small camera samples cannot establish citywide superlatives. Those sampling limits and insufficient-image conclusions are retained by the server even if the model tries to omit them. Tools may fail, and the system may abstain rather than answer. This reduces unsupported final claims; it does not make source data or vision interpretation infallible.

## Runtime

```sh
# Project root
npm run dev

# Second terminal
cd poi-brain
.venv/bin/python -m pip install -r requirements-cpu.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
```

Operations uses `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL` and `LMSTUDIO_API_KEY` from **poi-brain/.env**. The local model must support vision and function/tool calling. Optional `ASSISTANT_MODEL` selects a different chat model without changing the vision model. No hosted LLM API or geographic API key is required by default.

Optional backend settings:

```dotenv
OSRM_BASE_URL=https://routing.openstreetmap.de/routed-car
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
MCP_INTERNAL_URL=http://127.0.0.1:8080/mcp/
CAMERA_BACKGROUND_POLLING_ENABLED=false
```

Geocoding and routing requests go to public internet services, with caching and at most one request per second per service. Vision requests go to the configured LM Studio server. Keep this local prototype on loopback; public deployment needs authentication and a suitable routing/geocoding service plan or self-hosted services.

## MCP connection

The official Python MCP SDK serves **Streamable HTTP** at:

```text
http://127.0.0.1:8080/mcp/
```

The dashboard assistant is an actual MCP client: it initializes a session, discovers tools, sends tool schemas to LM Studio, executes the model's tool calls through MCP, and streams results to the browser. It supports these tools:

- `find_cameras(location, radius_m, limit)` — search the loaded catalog or geocode an NYC landmark.
- `get_camera_risk(camera_id)` — historical context and Operations analysis freshness.
- `analyze_camera(camera_id, notes)` — on-demand snapshot analysis, isolated from the legacy background poller.
- `plan_route(camera_ids, start_location)` — 2–6 distinct camera stops, visited in the supplied order; optional starting place.
- `start_monitoring(camera_ids, interval_seconds, label)` — one shared zone with 1–3 distinct cameras; serial inference, a 30–300 second pause after each camera, and no silent replacement of an active zone.
- `stop_monitoring(session_id)` — cancel the active zone; safe to call repeatedly. Optional ID prevents stopping a replacement session.
- `get_monitoring_status()` — actual state, workload limits, counters and the latest 24 observations.
- `acknowledge_monitoring_alert(alert_id)` — explicitly acknowledge one returned alert as reviewed; does not resolve an incident or stop monitoring. Status also includes retained alerts and pending counts.
- `compare_camera_traffic(camera_ids)` — one-off image comparison, capped at three cameras and 120 seconds, with separate historical traffic-count context. Does not start recurring monitoring.
- `compare_routes(metric, route_id)` — compare suggested patrols by peak stop-cell collision count, shortest travel time/distance, or historical rank; returns real route geometry for highlighting.

Monitoring is owned by the backend, so navigation and page reloads do not stop it. Only explicit Stop or backend shutdown does. State and recent observations are in memory and reset on backend restart. Only one Operations snapshot inference runs at a time (monitoring, one-off analysis and traffic comparisons share a lock). This is a local single-operator prototype; it does not impose a GPU budget on other apps using LM Studio. Historical risk computation remains separate. No measured throughput or GPU savings are claimed.

Potential-hazard alerts are stored separately in `DATA_ROOT/operations-alerts.sqlite3`, including the exact image bytes analyzed, flagged descriptions, timestamps and acknowledgment state. The latest 100 flagged frames are retained across new sessions and backend restarts; older records/images age out together. Normal frames do not create alerts. Failed analysis stays unknown. A storage failure is shown explicitly rather than hiding the model's hazard flag. Alerts are local review notices; nothing is dispatched or sent to another person. Test hazards use an isolated temporary database, never the live alert history.

Interview explanation: “Inference is my constrained resource. I use historical context to help an operator choose a small zone, then explicitly allocate vision inference to those cameras. The operator can stop that work immediately. The prototype caps the zone at three cameras, serializes image analysis, and shows timestamps and failures rather than implying continuous coverage.”

You may connect another MCP client to the same local endpoint. No global client configuration is changed by this implementation.

## What the displays mean

- Solid blue routes are road geometry; the selected route is amber. If routing fails, no invented straight-line substitute is drawn.
- The suggested routes use the existing greedy stop selection, capped at four stops plus a starting point. Road durations enforce a 30-minute driving budget. These are simulated proposals, not dispatches or proven optimal routes.
- Custom routes follow the supplied camera order. All times exclude live traffic and time spent at stops.
- Historical scores and reasons retain the existing prototype methodology: relative rankings, source-relative date windows, and rule-derived training labels. They are not validated forecasts or calibrated probabilities.
- Freshness is specific to Operations: **Not analyzed**, **Analyzing**, **Recent analysis**, **Stale analysis** (over two minutes), **Analysis failed**, or **Snapshot unavailable**. Snapshot time is when the image was fetched, not a guarantee of the camera's capture time.
- Model observations need visual review. Invalid, empty or truncated output is a failure, not a normal/safe-scene result.

## Verification

```sh
# Project root
./node_modules/.bin/tsc --noEmit --incremental false
# poi-brain
.venv/bin/python -m unittest discover -s tests -v
```

The unit tests cover road-geometry use, cumulative ETAs, road-time budget enforcement, failure states, camera validation and isolation from the legacy freshness state. Live checks additionally exercise MCP discovery, camera search, risk lookup, routing and frame analysis.
