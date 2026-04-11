'use client'

import Link from 'next/link'
import Image from 'next/image'

// Auth stripped: always just route to the landing page, no Supabase check.
export default function HomeLink() {
  return (
    <Link href="/" className="flex items-center">
      <span className="text-lg font-semibold tracking-tight">
        Person of Interest
      </span>
    </Link>
  )
}
