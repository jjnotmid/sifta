'use client';

import { useEffect, useState } from 'react';
import example from '@/data/worked-example.json';
import { useInView, usePrefersReducedMotion } from '@/lib/use-in-view';

/**
 * The homepage's opening argument, as one real case that resolves in front of
 * the reader.
 *
 * Every value is measured, not written: the subject is a real OFAC-listed
 * individual, the spelling is real output from the Phase 3 variant generator,
 * and both scores come from the same two matchers the evaluation runs.
 * `npm run eval:example` regenerates it.
 *
 * It leads the page because the previous version opened with the value
 * proposition in the abstract, and a reader who does not already work in
 * sanctions compliance had no way in. A name, two verdicts, and one sentence
 * does the work that three paragraphs of positioning could not.
 *
 * The motion is the brief's, not decoration: the two rows sit at "Screening"
 * and then snap to their verdicts, 120ms, one hard stop each. Nothing floats
 * or fades. It exists so a visitor watches the comparison happen instead of
 * reading a static table and having to work out what it is claiming.
 */

interface Example {
  written: string;
  listed: string;
  variantKind: string;
  nationality: string | null;
  baselineScore: number;
  baselineThreshold: number;
  siftaDistance: number;
  siftaThreshold: number;
  entitiesOnList: number;
  baselineFalsePositivesAtOperating: number;
  baselineThresholdToCatch: number;
  baselineFalsePositivesToCatch: number;
}

const KIND_LABEL: Record<string, string> = {
  initialised: 'middle names written as initials',
  shortened: 'a traditional name written in its short form',
  reordered: 'surname written first',
  deaccented: 'accents dropped',
  translit: 'a common alternative spelling',
  dropped: 'a middle name left out',
};

export function WorkedExample() {
  const e = example as Example;
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();

  // 0 = both screening, 1 = baseline resolved, 2 = both resolved.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setStage(2);
      return;
    }
    const a = window.setTimeout(() => setStage(1), 600);
    const b = window.setTimeout(() => setStage(2), 1200);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [inView, reduced]);

  const extraFalsePositives =
    e.baselineFalsePositivesToCatch - e.baselineFalsePositivesAtOperating;

  return (
    <div ref={ref}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--s-5)',
          marginBottom: 'var(--s-5)',
        }}
      >
        <Panel label="A customer sends money as">
          <p className="t-data" style={{ fontSize: 20, lineHeight: '28px', margin: 0 }}>
            {e.written}
          </p>
          <p className="t-data-sm muted" style={{ margin: 'var(--s-1) 0 0' }}>
            {KIND_LABEL[e.variantKind] ?? e.variantKind}
          </p>
        </Panel>

        <Panel label="The sanctions list says">
          <p className="t-data" style={{ fontSize: 20, lineHeight: '28px', margin: 0 }}>
            {e.listed}
          </p>
          <p className="t-data-sm muted" style={{ margin: 'var(--s-1) 0 0' }}>
            {e.nationality ? `${e.nationality} · ` : ''}OFAC SDN — {e.entitiesOnList.toLocaleString()}{' '}
            entities searched
          </p>
        </Panel>
      </div>

      <table className="table" style={{ marginBottom: 'var(--s-4)' }}>
        <tbody>
          <Verdict
            system="Ordinary name matching"
            detail={`scores ${e.baselineScore.toFixed(2)}, needs ${e.baselineThreshold.toFixed(2)}`}
            caught={false}
            resolved={stage >= 1}
          />
          <Verdict
            system="Sifta"
            detail={`distance ${e.siftaDistance.toFixed(2)}, allows ${e.siftaThreshold.toFixed(2)}`}
            caught
            resolved={stage >= 2}
          />
        </tbody>
      </table>

      <p className="t-body" style={{ margin: 0, maxWidth: 640 }}>
        Same person. One system lets him through.
      </p>
      <p className="t-data-sm muted" style={{ margin: 'var(--s-2) 0 0', maxWidth: 640 }}>
        You could loosen the first system until it catches him — at{' '}
        {e.baselineThresholdToCatch.toFixed(2)} it does. It also flags{' '}
        {e.baselineFalsePositivesToCatch.toLocaleString()} innocent customers instead of{' '}
        {e.baselineFalsePositivesAtOperating.toLocaleString()}, so one more real hit costs your
        analysts {extraFalsePositives.toLocaleString()} more files to clear by hand.
      </p>
    </div>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="t-label muted">{label}</span>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

/** Amber marks the catch, and nothing else on this page is amber. */
function Verdict({
  system,
  detail,
  caught,
  resolved,
}: {
  system: string;
  detail: string;
  caught: boolean;
  resolved: boolean;
}) {
  return (
    <tr
      style={{
        borderLeft: `4px solid ${resolved && caught ? 'var(--amber)' : 'transparent'}`,
        transition: 'border-color var(--t-state) var(--ease)',
      }}
    >
      <td className="t-h3" style={{ paddingLeft: 'var(--s-3)' }}>
        {system}
      </td>
      <td className="t-data-sm muted">{resolved ? detail : ''}</td>
      <td
        className="t-label"
        style={{
          textAlign: 'right',
          minWidth: 132,
          color: resolved ? (caught ? 'var(--amber)' : 'var(--cleared)') : 'var(--navy-300)',
          transition: 'color var(--t-state) var(--ease)',
        }}
      >
        {resolved ? (caught ? 'Match' : 'No match') : 'Screening'}
      </td>
    </tr>
  );
}
