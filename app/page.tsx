import Link from "next/link"
import ParticleBackground from "@/components/particle-background"
import AnimatedText from "@/components/animated-text"

export default async function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-radial-gradient"></div>
      <ParticleBackground />
      <div className="z-10 text-center space-y-4">
        <h1 className="text-6xl font-bold mb-2 text-white glow-text">Person of Interest</h1>
        <AnimatedText />
        {/* Auth stripped: "Get Started" now drops straight into the dashboard. */}
        <Link
          href="/protected"
          className="inline-block px-8 py-3 mt-6 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full text-xl font-semibold transition-all duration-300 ease-in-out hover:from-purple-500 hover:to-blue-500 hover:translate-y-[-4px] hover:shadow-lg hover:shadow-purple-500/25"
        >
          Get Started
        </Link>
      </div>
    </main>
  )
}