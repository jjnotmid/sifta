import Link from 'next/link';
import { CountUp } from '@/components/count-up';
import { Field, type FieldCell } from '@/components/field';
import { Logo } from '@/components/logo';
import { WorkedExample } from '@/components/worked-example';
import { MATCH_THRESHOLD } from '@/lib/constants';
import { readEvalHeadline } from '@/lib/eval';
import { getHeroCandidates } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/**
 * Marketing page — SIFTA-DESIGN-BRIEF.md §9, one page.
 *
 * Rewritten after the first version failed the only test that matters: the
 * project's own owner could not tell what the product did from it. It opened
 * with the value proposition stated abstractly, put an unlabelled grid of
 * squares above the fold, and reached "recall", "precision", "Jaro-Winkler"
 * and "L2 distance" before the reader had any idea what was being screened.
 * All of it accurate, none of it legible to anyone who does not already work
 * in sanctions compliance.
 *
 * It now opens with one real case — a real listed person, a real spelling, two
 * real verdicts — and only reaches the aggregate numbers once the reader knows
 * what a hit and a false positive actually are. Every count is given a human
 * referent, because "2,643 false positives" means nothing and "2,643 innocent
 * customers cleared by hand" means everything.
 *
 * Visual system is unchanged: the brief, applied as written.
 */
export default async function MarketingPage() {
  const headline = readEvalHeadline();
  const heroCells = await loadHeroField();

  return (
    <main>
      {/* ---- Lead: one real case -------------------------------------- */}
      <section className="shell" style={{ paddingTop: 'var(--s-7)', paddingBottom: 'var(--s-6)' }}>
        <h1 className="t-display" style={{ margin: '0 0 var(--s-5)', maxWidth: 860 }}>
          A sanctioned man walks through your screening because he wrote his name differently.
        </h1>

        <WorkedExample />

        <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-5)' }}>
          <Link
            href="/queue"
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            Open the console
          </Link>
          <Link href="#how" className="btn" style={{ display: 'inline-flex', alignItems: 'center' }}>
            How it works
          </Link>
        </div>
      </section>

      {/* ---- What a screen looks like, with a legend ------------------- */}
      {heroCells.length > 0 ? (
        <section style={{ borderTop: '1px solid var(--rule)', background: 'var(--paper)' }}>
          <div className="shell" style={{ padding: 'var(--s-6) var(--s-4)' }}>
            <h2 className="t-h2" style={{ marginTop: 0 }}>
              One screen, drawn
            </h2>
            <p className="t-body" style={{ maxWidth: 620, color: 'var(--navy-500)' }}>
              Every square is a name the search pulled back for one customer. Most are ruled out
              on the evidence. Amber is the one that is not.
            </p>

            <div style={{ margin: 'var(--s-5) 0' }}>
              <Field cells={heroCells} columns={20} size={20} />
            </div>

            <Legend />
          </div>
        </section>
      ) : null}

      {/* ---- The aggregate cost, with human referents ------------------ */}
      <section style={{ borderTop: '1px solid var(--rule)' }}>
        <div className="shell" style={{ padding: 'var(--s-7) var(--s-4)' }}>
          <h2 className="t-h2" style={{ marginTop: 0 }}>
            The expensive part is the customers who are not on the list.
          </h2>
          <p className="t-body" style={{ maxWidth: 680, color: 'var(--navy-500)' }}>
            We screened {headline.negatives.toLocaleString()} ordinary Nigerian names — none of
            them on any sanctions list — against all {headline.entities.toLocaleString()} entities
            OFAC publishes. Both systems were tuned to catch the same share of real hits, then
            judged on how many innocent people they flagged.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 320px))',
              gap: 'var(--s-4)',
              marginTop: 'var(--s-5)',
            }}
          >
            <Stat
              label="Ordinary name matching"
              value={headline.baselineFalsePositives}
              note="innocent customers flagged for an analyst to clear by hand"
            />
            <Stat
              label="Sifta"
              value={headline.siftaFalsePositives}
              note="innocent customers flagged, at the same catch rate"
            />
          </div>

          <p className="t-h3" style={{ marginTop: 'var(--s-5)', marginBottom: 'var(--s-2)' }}>
            {headline.reduction} less work, for the same protection.
          </p>
          <p className="t-data-sm muted" style={{ margin: 0, maxWidth: 680 }}>
            Both systems see every alias OFAC publishes. The only difference is the{' '}
            {headline.variants.toLocaleString()} spellings Sifta generates in advance. Every test
            name also carries a typo, so it appears word-for-word in neither system&apos;s index —
            each one has to recognise a name it has never seen exactly.
          </p>
        </div>
      </section>

      {/* ---- How it works: three steps, no icons ----------------------- */}
      <section id="how" className="shell" style={{ padding: 'var(--s-7) var(--s-4)' }}>
        <h2 className="t-h2" style={{ marginTop: 0 }}>
          How it works
        </h2>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', maxWidth: 720 }}>
          <Step
            n="01"
            title="Write down the spellings the list does not have"
            body="A sanctions list gives you one official spelling and a few aliases. Sifta expands each name into the forms people actually write — surname first, accents dropped, middle names as initials, Chukwuemeka written as Emeka — and stores every one."
          />
          <Step
            n="02"
            title="Match on similarity, not on spelling"
            body="Each stored spelling becomes a vector, so names that look different but read the same land near each other. Character-by-character matching cannot cross a reordering and a respelling at once. This can."
          />
          <Step
            n="03"
            title="Remember what your analysts decided"
            body="When the same customer is flagged again, Sifta finds the decision your team already made and the reason they gave for it. If nothing about the evidence has changed, the alert is closed on that record — no second investigation, and no model involved."
          />
        </ol>
      </section>

      {/* ---- Architecture ---------------------------------------------- */}
      <section style={{ borderTop: '1px solid var(--rule)', background: 'var(--paper)' }}>
        <div className="shell" style={{ padding: 'var(--s-7) var(--s-4)' }}>
          <h2 className="t-h2" style={{ marginTop: 0 }}>
            Architecture
          </h2>
          <p className="t-body" style={{ maxWidth: 680, color: 'var(--navy-500)' }}>
            One CockroachDB cluster holds the watchlist, the generated spellings and their
            vectors, the alerts, the agent&apos;s working notes, and the decision ledger — so
            recalling a past decision is a database join, not a second system to keep in sync.
          </p>
          <pre
            className="t-data-sm"
            style={{
              border: '1px solid var(--rule)',
              padding: 'var(--s-4)',
              overflowX: 'auto',
              margin: 'var(--s-4) 0 0',
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
            The agent proposes; a person decides. Decisions are append-only — the
            application&apos;s database role has no permission to update or delete one, so a
            signed decision cannot be quietly rewritten later.
          </p>
        </div>
      </section>

      {/* ---- One call to action ---------------------------------------- */}
      <section className="shell" style={{ padding: 'var(--s-7) var(--s-4) var(--s-8)' }}>
        <h2 className="t-h2" style={{ marginTop: 0 }}>
          Open the console
        </h2>
        <p className="t-body" style={{ maxWidth: 560, color: 'var(--navy-500)' }}>
          Real OFAC entries, real generated spellings, real distances. Nothing on the queue is
          made up.
        </p>
        <Link
          href="/queue"
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', marginTop: 'var(--s-3)' }}
        >
          Open the console
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
          {/* §0: the logo is the data visualisation — navy modules with a few
              amber ones, which is the product in one image. */}
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

/** The Field is only self-explanatory once you are told what a square is. */
function Legend() {
  const items: [FieldCell['state'], string][] = [
    ['candidate', 'a name the search returned'],
    ['cleared', 'ruled out'],
    ['match', 'a match — the only thing that is ever amber'],
  ];

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        gap: 'var(--s-5)',
        flexWrap: 'wrap',
      }}
    >
      {items.map(([state, label]) => (
        <li key={state} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
          <span
            style={{
              width: 16,
              height: 16,
              border: '1px solid',
              borderColor:
                state === 'match'
                  ? 'var(--amber)'
                  : state === 'cleared'
                    ? 'var(--cleared)'
                    : 'var(--navy-500)',
              background:
                state === 'match'
                  ? 'var(--amber)'
                  : state === 'cleared'
                    ? 'transparent'
                    : 'var(--navy-500)',
            }}
          />
          <span className="t-data-sm muted">{label}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div style={{ border: '1px solid var(--rule)', padding: 'var(--s-4)' }}>
      <div className="t-label muted">{label}</div>
      <div className="t-h1" style={{ margin: 'var(--s-2) 0 0' }}>
        {/* §7: a numeric counter ticking is one of the three permitted
            animations, and the only one that suits a figure this large. */}
        <CountUp value={value} />
      </div>
      <div className="t-data-sm muted">{note}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li
      style={{
        borderTop: '1px solid var(--rule)',
        padding: 'var(--s-4) 0',
        display: 'flex',
        gap: 'var(--s-4)',
      }}
    >
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
 * The Field shows a real candidate set from the database — the most recent
 * investigation that recorded one. There is no synthetic fallback: an empty or
 * unreachable database renders no grid rather than a decorative one, because a
 * fake Field on the marketing page would be exactly the "AI slop" the brief
 * bans. The page itself stays up either way.
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
