export type ExportRow = Record<string, unknown>;

export function serializeJson(rows: ExportRow[]) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: rows.length,
      rows
    },
    null,
    2
  );
}

export function serializeCsv(rows: ExportRow[]) {
  const columns = getColumns(rows);

  if (!columns.length) {
    return "";
  }

  return [
    columns.map(escapeCsvValue).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsvValue(row[column])).join(",")
    )
  ].join("\n");
}

function getColumns(rows: ExportRow[]) {
  const columns = new Set<string>();

  for (const row of rows) {
    for (const column of Object.keys(row)) {
      columns.add(column);
    }
  }

  return Array.from(columns);
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }

  return text;
}
