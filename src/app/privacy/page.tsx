import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Legal</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-white">Privacy notice</h1>
      <p className="mt-3 text-sm text-zinc-600">Last updated October 22, 2026</p>
      <div className="mt-9 space-y-7 text-sm leading-7 text-zinc-400">
        <section><h2 className="text-lg font-black text-white">What we collect</h2><p className="mt-2">LoL Fantasy stores your username, authentication identifier, submitted rosters, captain choices, and fantasy results. It does not ask for an email address. Password authentication and session cookies are handled through Supabase.</p></section>
        <section><h2 className="text-lg font-black text-white">How data is used</h2><p className="mt-2">Account data is used to authenticate you, enforce roster ownership, operate contests, calculate rankings, prevent abuse, and diagnose failures. Usernames and fantasy results are visible on authenticated leaderboards; opponent lineups reveal after the relevant stage locks.</p></section>
        <section><h2 className="text-lg font-black text-white">Service providers</h2><p className="mt-2">The application may use Supabase for authentication and database hosting, Vercel for web hosting, Cloudflare Turnstile for abuse prevention, GitHub Actions for scheduled scoring work, and Cito for esports data. Those providers may process technical information such as IP addresses and request logs under their own policies.</p></section>
        <section><h2 className="text-lg font-black text-white">Retention and control</h2><p className="mt-2">Contest and scoring records are retained to preserve leaderboard history and operational audit trails. Contact the operator if you need account assistance or want to request removal of an account where legal and contest-integrity requirements permit it.</p></section>
        <section><h2 className="text-lg font-black text-white">Contact</h2><p className="mt-2">Questions can be raised through the <a className="font-bold text-cyan-300 hover:text-cyan-200" href="https://github.com/JoshuaAaronBaker/LoL-Fantasy/issues">project issue tracker</a>.</p></section>
      </div>
      <Link href="/" className="mt-10 inline-flex text-sm font-bold text-lime-300 hover:text-lime-200">Return home</Link>
    </main>
  );
}
