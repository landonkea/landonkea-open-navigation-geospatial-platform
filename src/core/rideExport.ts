// ── Turning sampled history rows into a downloadable file ───────────
// WHAT: the build prompt's "Ride data export" section wants an admin
// to be able to download a finished ride's route as GPX or CSV.
// ride_history_samples (see src/core/sync.ts for how it gets
// populated) already holds exactly the raw rows needed, this file's
// only job is reshaping those rows into the two output formats,
// nothing here talks to Supabase or the DOM, kept pure/testable like
// gpx.ts's parsing side.

export type HistorySample = {
  participantId: string;
  lat: number;
  lng: number;
  recordedAt: string; // ISO 8601, straight from the database's recorded_at column
};

/**
 * Escapes the handful of characters that are special inside GPX/XML
 * text content. participantId values are UUIDs today (never contain
 * these characters), this exists so the function stays correct even
 * if that ever changes, rather than assuming the input is always
 * "safe" and finding out otherwise later.
 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Groups a flat list of samples (however they arrived, e.g. one
 * combined query for a whole ride) by which participant recorded
 * them, sorted oldest-first within each group so a track's points
 * connect in the order they actually happened.
 */
// Exported (not just used internally here) so rideRecap.ts's distance
// computation can group the exact same way instead of re-implementing
// the same grouping/sorting logic a second time.
export function groupByParticipant(samples: HistorySample[]): Map<string, HistorySample[]> {
  const groups = new Map<string, HistorySample[]>();
  for (const sample of samples) {
    const existing = groups.get(sample.participantId);
    if (existing) {
      existing.push(sample);
    } else {
      groups.set(sample.participantId, [sample]);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)); // ISO 8601 strings sort chronologically as plain text
  }
  return groups;
}

/**
 * Builds a GPX 1.1 file's full text content, one <trk> (track) per
 * participant so an admin reviewing the export can tell riders'
 * separate paths apart rather than seeing one tangled line.
 *
 * @param rideName - shown in the file's top-level <name>, purely
 *   cosmetic (helps identify the file if renamed after download).
 * @param samples - every sample for the ride, any order, any mix of
 *   participants, this function does its own grouping/sorting.
 * @returns the complete GPX file text, ready to write straight to a
 *   .gpx file, empty samples still produce a valid (trackless) file.
 */
export function samplesToGpx(rideName: string, samples: HistorySample[]): string {
  const groups = groupByParticipant(samples);

  const tracks = [...groups.entries()]
    .map(([participantId, points]) => {
      const trackPoints = points
        .map(
          (p) =>
            `      <trkpt lat="${p.lat}" lon="${p.lng}"><time>${escapeXmlText(p.recordedAt)}</time></trkpt>`,
        )
        .join("\n");
      return `  <trk>\n    <name>${escapeXmlText(participantId)}</name>\n    <trkseg>\n${trackPoints}\n    </trkseg>\n  </trk>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Open Navigation & Geospatial Platform" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata>\n    <name>${escapeXmlText(rideName)}</name>\n  </metadata>\n${tracks}\n</gpx>\n`;
}

/**
 * Builds a CSV file's full text content, one row per sample, sorted
 * so all of one participant's points stay together and stay
 * chronological (readable in a spreadsheet, not just correct data).
 * No quoting/escaping needed: every field is a UUID, a number, or an
 * ISO 8601 timestamp, none of which can ever contain a comma or
 * newline, so plain comma-joining is safe here, unlike arbitrary
 * user-entered text.
 *
 * @param samples - every sample for the ride, any order.
 * @returns CSV text with a header row, ready to write straight to a
 *   .csv file.
 */
export function samplesToCsv(samples: HistorySample[]): string {
  const groups = groupByParticipant(samples);
  const rows = [...groups.values()]
    .flat()
    .map((p) => `${p.participantId},${p.lat},${p.lng},${p.recordedAt}`);
  return ["participant_id,lat,lng,recorded_at", ...rows].join("\n") + "\n";
}
