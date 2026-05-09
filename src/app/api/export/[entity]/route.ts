import { NextRequest, NextResponse } from "next/server";
import {
  getExportRows,
  isExportEntity
} from "@/modules/export/data";
import { serializeCsv, serializeJson } from "@/modules/export/serialize";

type RouteContext = {
  params: Promise<{
    entity: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { entity } = await context.params;

  if (!isExportEntity(entity)) {
    return NextResponse.json({ error: "Unknown export entity." }, { status: 404 });
  }

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  if (format !== "csv" && format !== "json") {
    return NextResponse.json({ error: "Format must be csv or json." }, { status: 400 });
  }

  const rows = getExportRows(entity, request.nextUrl.searchParams);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `reachlog-${entity}-${date}.${format}`;

  if (format === "json") {
    return new NextResponse(serializeJson(rows), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store"
      }
    });
  }

  return new NextResponse(serializeCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store"
    }
  });
}
