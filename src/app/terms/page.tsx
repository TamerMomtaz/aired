import Link from "next/link";

export const metadata = {
  title: "Community Covenant · AIRED",
  description:
    "The agreement every AIRED creator makes when a work goes live: rights, honest credit, the Red Line claim, and the boundaries that protect every listener.",
};

// The Community Covenant. Public, /terms — every Go Live action links here, and
// the modal reads the summary. This is the v1 placeholder text. The owner will
// refine the copy; the structure (rights · credit · the Red Line · boundaries)
// is the part that earns its place in the product.
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12">
      <header className="mb-8 flex flex-col gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted/70">
          The Community Covenant
        </span>
        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">
          AI-ed and proud, together.
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          AIRED is built on one quiet idea: <em>no one ever made anything
          alone</em>. The Volley Ledger reveals the connection — carbon and
          silicon, named together. This Covenant is the agreement every creator
          makes when a work goes live. Short, plain, and meant to protect
          everyone — listener and maker alike.
        </p>
      </header>

      <article className="flex flex-col gap-8 text-sm leading-relaxed text-foreground/85">
        <Section number="1" title="You hold the rights.">
          <p>
            When you press Go Live, you confirm that the audio, lyrics, and
            artwork are yours to publish — created by you, by people who agreed
            to be credited, or by AI you directed. If a sample, melody, or
            voice belongs to someone else, you have permission to use it.
          </p>
        </Section>

        <Section number="2" title="Credit every contributor by name.">
          <p>
            Every hand that shaped the work belongs in the Volley Ledger,
            carbon and silicon alike. The platform does not hide AI in the fine
            print — it celebrates AI as a named collaborator. Naming a model is
            not optional; it is the work&apos;s honesty.
          </p>
        </Section>

        <Section number="3" title="The Red Line certifies authorship and process — never resemblance.">
          <p>
            The Red Line is a certificate of <em>how this was made</em>:
            human-architected, AI-rendered, process-attested. It will never say
            &ldquo;sounds like&rdquo; or &ldquo;in the style of&rdquo; anyone.
            The platform itself refuses to store the names of third-party
            artists or songs — references are mapped to neutral sonic
            descriptors before any public write. Your verbatim prompts and craft
            stay sealed, encrypted and yours.
          </p>
        </Section>

        <Section number="4" title="Keep the registry honest.">
          <p>
            No impersonation. No deepfaked voices of real people without their
            consent. No content that exists to harm — to harass, to defame, to
            sexualize anyone underage, to incite violence. Works that breach
            this can be taken down without notice.
          </p>
        </Section>

        <Section number="5" title="The ledger is immutable; the certificate is immutable.">
          <p>
            Once a volley is sealed it stays sealed. Once a Red Line is issued
            it stays issued. You can keep adding to the ledger as the work
            evolves, but the trail is permanent. The Red Line is your signed
            head of that trail.
          </p>
        </Section>

        <Section number="6" title="Listeners stream free.">
          <p>
            Audio is served from a CDN that costs the platform almost nothing
            to run — by design. The platform makes no claim of ownership over
            your work; you can take it down, and you can publish it elsewhere.
            AIRED is the destination, not a key to someone else&apos;s house.
          </p>
        </Section>
      </article>

      <footer className="mt-12 flex flex-col gap-3 border-t border-white/8 pt-8 text-xs text-muted">
        <p>
          This is the v1 Covenant. We&apos;ll iterate as the platform learns;
          changes never apply retroactively to works already live.
        </p>
        <p className="font-mono text-muted/70">Σ I — within the without.</p>
        <Link
          href="/"
          className="self-start text-cert-red underline-offset-4 hover:underline"
        >
          ← Back to AIRED
        </Link>
      </footer>
    </main>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-cert-red">
          {number}
        </span>
        <span className="text-lg font-semibold text-foreground">{title}</span>
      </h2>
      <div className="text-muted/90">{children}</div>
    </section>
  );
}
