import Link from "next/link";
import { ArrowRight, LockKeyhole, Scissors, Sparkles, Zap } from "lucide-react";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <Link href="/" className="brand"><span className="brand-mark"><Scissors size={18} /></span>autocut</Link>
        <Link href="/editor" className="button button-ghost">Open editor <ArrowRight size={16} /></Link>
      </nav>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> Fast, automatic video editing</div>
        <h1>Cut the silence.<br /><span>Keep the story.</span></h1>
        <p>Drop in a video and AutoCut finds the quiet parts, builds your timeline, and exports a clean MP4 using fast native server processing.</p>
        <div className="hero-actions">
          <Link href="/editor" className="button button-primary">Edit a video <ArrowRight size={17} /></Link>
          <span className="privacy-note"><LockKeyhole size={15} /> Your video never leaves your device</span>
        </div>
        <div className="feature-strip">
          <div><Zap /><strong>Automatic cuts</strong><span>Find silent gaps in seconds</span></div>
          <div><Scissors /><strong>Fine control</strong><span>Trim, split, merge, undo</span></div>
          <div><LockKeyhole /><strong>Private by default</strong><span>Temporary, expiring uploads</span></div>
        </div>
      </section>
    </main>
  );
}
