import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">Legal</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-white">Terms of use</h1>
      <p className="mt-3 text-sm text-zinc-600">Last updated October 22, 2026</p>
      <div className="mt-9 space-y-7 text-sm leading-7 text-zinc-400">
        <section><h2 className="text-lg font-black text-white">Fantasy competition</h2><p className="mt-2">This service is an entertainment fantasy game. Unless a contest explicitly states otherwise, there are no entry fees, wagers, or prizes. Scoring follows the rules displayed by the application and may be corrected when the underlying provider corrects its data.</p></section>
        <section><h2 className="text-lg font-black text-white">Accounts</h2><p className="mt-2">You are responsible for protecting your password and for activity performed through your account. Usernames must not impersonate others or contain unlawful, abusive, or infringing material. Accounts that disrupt the service or manipulate a contest may be restricted.</p></section>
        <section><h2 className="text-lg font-black text-white">Availability and results</h2><p className="mt-2">The service and esports data are provided on an as-available basis. Provider outages, corrections, substitutions, postponed matches, and software failures can delay or change results. The operator may correct clear scoring or data errors while preserving an audit trail.</p></section>
        <section><h2 className="text-lg font-black text-white">Unofficial project</h2><p className="mt-2">LoL Fantasy is an independent project and is not endorsed by Riot Games or professional teams. League of Legends, team marks, player images, and related names belong to their respective owners.</p></section>
        <section><h2 className="text-lg font-black text-white">Contact</h2><p className="mt-2">Questions can be raised through the <a className="font-bold text-cyan-300 hover:text-cyan-200" href="https://github.com/JoshuaAaronBaker/LoL-Fantasy/issues">project issue tracker</a>.</p></section>
      </div>
      <Link href="/" className="mt-10 inline-flex text-sm font-bold text-lime-300 hover:text-lime-200">Return home</Link>
    </main>
  );
}
