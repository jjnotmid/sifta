import Link from 'next/link';
import { Field, type FieldCell } from '@/components/field';
import { Logo } from '@/components/logo';
import { MATCH_THRESHOLD } from '@/lib/constants';
import { readEvalHeadline } from '@/lib/eval';
import { getHeroCandidates } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Marketing page — SIFTA-DESIGN-BRIEF.md §9, one page.
 *
 * Hero is the Field, animating, with a single sentence beneath it. Then the
 * problem in plain measured numbers. Then how it works, three steps, no
 * icons. Then the architecture. Then one call to action.
 *
 * No pricing table, no testimonials, no logo wall, no feature-card triptych.
 * Every number on this page comes from `eval/results.md` or the live
 * database; if a source is absent the section is omitted rather than filled.
 */
export default async function MarketingPage() {
  const headline = readEvalHeadline();
  const heroCells = await loadHeroField();

  return (
    <main>
      {/* ---- Hero: the Field ------------------------------------------ */}
      <section
        className="shell"
        style={{ paddingTop: 'var(--s-8)', paddingBottom: 'var(--s-8)' }}
      >
        {heroCells.length > 0 ? (
          <div style={{ marginBottom: 'var(--s-6)' }}>
            <Field cells={heroCells} columns={24} size={20} />
          </div>
        ) : null}

        <h1 className="t-display" style={{ margin: 0, maxWidth: 900 }}>
          Screening that remembers what your analysts already decided.
        </h1>

        <p
          className="t-body"
          style={{ maxWidth: 640, marginTop: 'var(--s-4)', color: 'var(--navy-500)' }}
        >
          Sifta screens a customer against the sanctions list, and when the same person comes
          back it recalls the decision your team already made — with the analyst&apos;s own
          reasoning attached.
        </p>

        <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-5)' }}>
          <Link href="/queue" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center' }}>
            Open the queue
          </Link>
          <Link href="/ledger" className="btn" style={{ display: 'inline-flex', alignItems: 'center' }}>
            See the ledger
          </Link>
        </div>
      </section>

      {/* ---- The problem, in measured numbers -------------------------- */}
      <section
          style={{
            borderTop: '1px solid var(--rule)',
            borderBottom: '1px solid var(--rule)',
            background: 'var(--paper)',
          }}
        >
          <div className="shell" style={{ padding: 'var(--s-7) var(--s-4)' }}>
            <h2 className="t-h2" style={{ marginTop: 0 }}>
              The problem is false positives, not missed hits.
            </h2>
            <p className="t-body" style={{ maxWidth: 680, color: 'var(--navy-500)' }}>
              Screened against {headline.entities.toLocaleString()} real OFAC entities, both
              systems held to the same recall ({headline.matchedRecall}), on{' '}
              {headline.negatives.toLocaleString()} Nigerian names that appear on no list.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 320px))',
                gap: 'var(--s-4)',
                marginTop: 'var(--s-5)',
              }}
            >
              <Stat
                label="Jaro-Winkler baseline"
                value={headline.baselineFalsePositives.toLocaleString()}
                note={`false positives · ${headline.baselinePrecision} precision`}
              />
              <Stat
                label="Sifta"
                value={headline.siftaFalsePositives.toLocaleString()}
                note={`false positives · ${headline.siftaPrecision} precision`}
              />
            </div>

            <p className="t-data" style={{ marginTop: 'var(--s-5)' }}>
              {headline.reduction} fewer false positives at the same recall.
            </p>
            <p className="t-data-sm muted" style={{ margin: 0, maxWidth: 680 }}>
              Both systems see the full published alias list. The only difference is the{' '}
              {headline.variants.toLocaleString()} generated name variants Sifta embeds —
              reorderings, transliterations, traditional contractions. Every test name carries a
              character-level typo, so it appears verbatim in neither system&apos;s index.
            </p>
          </div>
        </section>

      {/* ---- How it works: three steps, no icons ----------------------- */}
      <section className="shell" style={{ padding: 'var(--s-7) var(--s-4)' }}>
        <h2 className="t-h2" style={{ marginTop: 0 }}>
          How it works
        </h2>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', maxWidth: 720 }}>
          <Step
            n="01"
            title="Generate the spellings the list does not have"
            body="Every sanctioned individual's name is expanded into the forms a West African customer might actually write — surname first, diacritics dropped, kw for ku, Chukwuemeka shortened to Emeka — then embedded as vectors."
          />
          <Step
            n="02"
            title="Screen by meaning, not by edit distance"
            body="A subject name is embedded and searched against the variant index. Character-level matchers cannot cross a reordering plus a transliteration; a vector search can."
          />
          <Step
            n="03"
            title="Recall the decision your team already made"
            body="Before the model runs, Sifta checks the ledger. If this subject was cleared before and nothing about the evidence changed, the alert is disposed from memory — with the original analyst's rationale attached, and no model call at all."
          />
        </ol>
      </section>

      {/* ---- Architecture ---------------------------------------------- */}
      <section
        style={{ borderTop: '1px solid var(--rule)', background: 'var(--paper)' }}
      >
        <div className="shell" style={{ padding: 'var(--s-7) var(--s-4)' }}>
          <h2 className="t-h2" style={{ marginTop: 0 }}>
            Architecture
          </h2>
          <pre
            className="t-data-sm"
            style={{
              border: '1px solid var(--rule)',
              padding: 'var(--s-4)',
              overflowX: 'auto',
              margin: 0,
              color: 'var(--navy-500)',
            }}
          >
{`OFAC SDN XML  ──▶  ingest  ──▶  watchlist_entity
                                      │
                                      ▼
                              variant generation
                                      │  embedded
                                      ▼
   subject  ──▶  screen  ──▶  name_variant  (VECTOR INDEX, partitioned by jurisdiction)
                                      │
                                      ▼
                                    alert  ──▶  agent loop  ──▶  investigation.tool_trace
                                                    │
                                    recall  ◀───────┤
                                      │             ▼
                                  decision  ◀──  human disposition
                                 (append-only: no UPDATE, no DELETE)`}
          </pre>
          <p className="t-data-sm muted" style={{ marginTop: 'var(--s-3)', maxWidth: 720 }}>
            One CockroachDB cluster holds all four memory layers — semantic, episodic,
            procedural, and the ledger — so a recall is a join, not a second system to keep in
            sync. Vector indexes are declared inline and prefixed by jurisdiction.
          </p>
        </div>
      </section>

      {/* ---- One call to action ---------------------------------------- */}
      <section className="shell" style={{ padding: 'var(--s-7) var(--s-4) var(--s-8)' }}>
        <h2 className="t-h2" style={{ marginTop: 0 }}>
          Open the queue
        </h2>
        <p className="t-body" style={{ maxWidth: 560, color: 'var(--navy-500)' }}>
          Real OFAC entries, real generated variants, real distances.
        </p>
        <Link
          href="/queue"
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', marginTop: 'var(--s-3)' }}
        >
          Open the queue
        </Link>
      </section>

      <footer style={{ borderTop: '1px solid var(--rule)' }}>
        <div
          className="shell"
          style={{
            padding: 'var(--s-6) var(--s-4)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 'var(--s-4)',
            flexWrap: 'wrap',
          }}
        >
          {/* The mark at size, in full colour. §0: the logo is the data
              visualisation — navy modules with a few amber ones, which is the
              product in one image. */}
          <div style={{ color: 'var(--navy-700)' }}>
            <Logo height={56} accent />
          </div>
          <p className="t-data-sm muted" style={{ margin: 0 }}>
            MIT licensed · built for the CockroachDB × AWS hackathon
          </p>
        </div>
      </footer>
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ border: '1px solid var(--rule)', padding: 'var(--s-4)' }}>
      <div className="t-label muted">{label}</div>
      <div className="t-h1" style={{ margin: 'var(--s-2) 0 0' }}>
        {value}
      </div>
      <div className="t-data-sm muted">{note}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li style={{ borderTop: '1px solid var(--rule)', padding: 'var(--s-4) 0', display: 'flex', gap: 'var(--s-4)' }}>
      <span className="t-data-sm muted" style={{ minWidth: 32 }}>
        {n}
      </span>
      <div>
        <h3 className="t-h3" style={{ margin: 0 }}>
          {title}
        </h3>
        <p className="t-body" style={{ margin: 'var(--s-1) 0 0', color: 'var(--navy-500)' }}>
          {body}
        </p>
      </div>
    </li>
  );
}

/**
 * The hero Field shows a real candidate set from the database — the most
 * recent investigation that recorded one. There is no synthetic fallback: an
 * empty or unreachable database renders no grid rather than a decorative one,
 * because a fake Field on the marketing page would be exactly the "AI slop"
 * the brief bans. The page itself stays up either way.
 */
async function loadHeroField(): Promise<FieldCell[]> {
  const candidates = await getHeroCandidates();
  return candidates.map((candidate) => {
    const distance = Number(candidate.distance);
    return {
      label: candidate.variantText,
      distance,
      state: distance <= MATCH_THRESHOLD ? ('match' as const) : ('cleared' as const),
    };
  });
}
