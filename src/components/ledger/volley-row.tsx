"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { editVolley } from "@/lib/ledger/actions";
import {
  DELTA_LABELS,
  DELTA_TYPES,
  ORIGIN_LABELS,
  ROLE_LABELS,
  VOLLEY_ORIGINS,
  VOLLEY_ROLES,
  formatSeq,
  originConflictMessage,
  type DeltaType,
  type VolleyOrigin,
  type VolleyRole,
} from "@/lib/ledger/types";
import type { TrailVolley } from "./volley-trail";

// Origin is the heart of the conductivity map: who carried this move — a human
// throw, a silicon catch, or a dialogue between them.
const ORIGIN_STYLE: Record<VolleyOrigin, string> = {
  HUMAN: "border-white/25 bg-white/10 text-foreground",
  AI: "border-cert-red/45 bg-cert-red/15 text-cert-red",
  DIALOGUE: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

const editSelectClass =
  "rounded-md border border-white/12 bg-white/5 px-2 py-1 text-xs text-foreground outline-none transition focus:border-cert-red/60 focus:ring-1 focus:ring-cert-red/40 disabled:opacity-60";

// One node of the ledger trail. Read mode shows SHAPES ONLY (origin · role ·
// delta + a sealed-craft glyph). When the viewer owns the work, an inline
// "Edit" corrects those public-skeleton fields without rebuilding the volley —
// the sealed craft and its hash are never touched.
export function VolleyRow({
  volley,
  canEdit,
  workId,
}: {
  volley: TrailVolley;
  canEdit: boolean;
  workId: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<VolleyRole>(volley.role);
  const [origin, setOrigin] = useState<VolleyOrigin>(volley.origin);
  const [deltaType, setDeltaType] = useState<DeltaType>(volley.delta_type);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Guard the origin against the contributor's type, mirroring the DB trigger,
  // so a contradiction is caught inline before any save.
  const agentType = volley.agent?.type ?? null;
  const conflict = agentType ? originConflictMessage(agentType, origin) : null;

  function startEditing() {
    setRole(volley.role);
    setOrigin(volley.origin);
    setDeltaType(volley.delta_type);
    setError(null);
    setEditing(true);
  }

  function onSave() {
    setError(null);
    if (conflict) {
      setError(conflict);
      return;
    }
    startTransition(async () => {
      const result = await editVolley({
        volleyId: volley.id,
        workId,
        role,
        origin,
        deltaType,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-cert-red">
          {formatSeq(volley.seq)}
        </span>
        <span className="text-muted/40" aria-hidden>
          ·
        </span>
        {volley.agent ? (
          volley.agent.profile_slug ? (
            <Link
              href={`/agent/${volley.agent.profile_slug}`}
              className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
            >
              {volley.agent.name}
            </Link>
          ) : (
            <span className="text-sm font-medium text-foreground">
              {volley.agent.name}
            </span>
          )
        ) : (
          <span className="text-sm text-muted">Unknown contributor</span>
        )}
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="ml-auto text-[11px] text-muted underline-offset-4 transition hover:text-foreground hover:underline"
          >
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Role"
              className={editSelectClass}
              value={role}
              onChange={(e) => setRole(e.target.value as VolleyRole)}
              disabled={pending}
            >
              {VOLLEY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <select
              aria-label="Origin"
              className={editSelectClass}
              value={origin}
              onChange={(e) => setOrigin(e.target.value as VolleyOrigin)}
              disabled={pending}
            >
              {VOLLEY_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {ORIGIN_LABELS[o]}
                </option>
              ))}
            </select>
            <select
              aria-label="Delta"
              className={editSelectClass}
              value={deltaType}
              onChange={(e) => setDeltaType(e.target.value as DeltaType)}
              disabled={pending}
            >
              {DELTA_TYPES.map((d) => (
                <option key={d} value={d}>
                  {DELTA_LABELS[d]}
                </option>
              ))}
            </select>
          </div>

          {conflict ? (
            <p className="text-[11px] text-cert-red">{conflict}</p>
          ) : error ? (
            <p role="alert" className="text-[11px] text-cert-red">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={pending || !!conflict}
              className="rounded-md bg-cert-red px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-white/12 px-3 py-1 text-xs text-muted transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${ORIGIN_STYLE[volley.origin]}`}
          >
            {ORIGIN_LABELS[volley.origin]}
          </span>
          <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted">
            {ROLE_LABELS[volley.role]}
          </span>
          <span className="text-[11px] text-muted/70">
            {DELTA_LABELS[volley.delta_type]}
          </span>
          {volley.private_hash ? (
            <span
              title={`Sealed craft · sha256 ${volley.private_hash.slice(0, 12)}…`}
              className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-muted/50"
            >
              <LockGlyph />
              sealed
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="size-3"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
