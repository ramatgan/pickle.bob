"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export default function HomePage() {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generatedSlug = useMemo(() => slugPreview(name), [name]);

  async function createGroup() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pin })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not create group");
        return;
      }

      setCreatedSlug(data.group.slug);
      setName("");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Pickleball Matchmaker</h1>
      <p className="small">Simplified v1: one shared PIN, one page per group.</p>

      <div className="card">
        <h2>Create Group</h2>
        <p className="small">
          Slug will be auto-generated: <strong>{generatedSlug || "group-name"}</strong>
        </p>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Group PIN"
            type="password"
          />
          <button
            type="button"
            disabled={loading || !name || !pin}
            onClick={() => void createGroup()}
          >
            Create
          </button>
        </div>

        {error && <p style={{ color: "#b91c1c" }}>{error}</p>}

        {createdSlug && (
          <p>
            Group created: <Link href={`/g/${createdSlug}`}>/g/{createdSlug}</Link>
          </p>
        )}
      </div>
    </main>
  );
}

function slugPreview(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}
