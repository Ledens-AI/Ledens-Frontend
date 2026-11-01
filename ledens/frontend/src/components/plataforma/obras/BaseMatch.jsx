import React from 'react';

// How a line relates to the base de partidas (DimPartida): the partida it was
// matched to, the annotations (price different from the base, PDF code that is
// another partida, untranslated text…) and a proposed new partida. Team only:
// the server never sends any of it to a client.
const ICON = { precio: 'ri-price-tag-3-line', codigo: 'ri-links-line', traduccion: 'ri-translate-2', nueva: 'ri-add-box-line', base: 'ri-error-warning-line', nota: 'ri-sticky-note-line' };

export default function BaseMatch({ item, onDiscardProposal }) {
  const notes = item.annotations || [];
  if (!item.baseCode && !item.proposal && !notes.length) return null;
  return (
    <div className="obr-base">
      {item.baseCode ? <span className="obr-base-chip"><i className="ri-database-2-line" aria-hidden="true"></i>{`Base: ${item.baseCode}`}{item.baseName ? ` · ${item.baseName}` : ''}</span> : null}
      {item.proposal ? (
        <span className="obr-base-chip is-new" title={item.proposal.reason || ''}>
          <i className="ri-add-box-line" aria-hidden="true"></i>{`Partida nueva propuesta: «${item.proposal.name}» (${item.proposal.unit}) · la aprueba un administrador`}
          {onDiscardProposal ? <button type="button" className="fin-btn is-ghost is-small" onClick={onDiscardProposal}>No proponer</button> : null}
        </span>
      ) : null}
      {notes.length ? (
        <ul className="obr-notes">
          {notes.map((a, k) => <li key={k} className={`is-${a.type}`}><i className={ICON[a.type] || ICON.nota} aria-hidden="true"></i>{a.text}</li>)}
        </ul>
      ) : null}
      {item.translation ? <div className="fin-muted fin-small">{`Traducción para casar: ${item.translation}`}</div> : null}
    </div>
  );
}
