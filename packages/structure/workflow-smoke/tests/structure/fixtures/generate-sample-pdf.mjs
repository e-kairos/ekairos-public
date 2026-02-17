import { writeFileSync } from "node:fs";
import { join } from "node:path";

function escapePdfText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pad10(n) {
  return String(n).padStart(10, "0");
}

function createMinimalPdfBytes(lines) {
  const fontSize = 12;
  const lineHeight = 16;
  const startX = 72;
  const startY = 720;

  const ops = [];
  ops.push("BT");
  ops.push(`/F1 ${fontSize} Tf`);
  ops.push(`${startX} ${startY} Td`);
  for (let i = 0; i < lines.length; i++) {
    const t = escapePdfText(lines[i] ?? "");
    ops.push(`(${t}) Tj`);
    if (i !== lines.length - 1) ops.push(`0 -${lineHeight} Td`);
  }
  ops.push("ET");

  const stream = ops.join("\n") + "\n";

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>"); // 1
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); // 2
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  ); // 3
  objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream`); // 4
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 5

  let out = "%PDF-1.4\n";
  const offsets = [0];

  for (let i = 0; i < objects.length; i++) {
    const objNum = i + 1;
    offsets[objNum] = Buffer.byteLength(out, "utf8");
    out += `${objNum} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(out, "utf8");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += `0000000000 65535 f \n`;
  for (let objNum = 1; objNum <= objects.length; objNum++) {
    out += `${pad10(offsets[objNum])} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  out += `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(out, "utf8");
}

const lines = ["code,description,price", "A1,Widget,10.5", "A2,Gadget,20", "A3,Thing,30.25"];
const bytes = createMinimalPdfBytes(lines);

const outPath = join(process.cwd(), "tests", "structure", "fixtures", "sample.pdf");
writeFileSync(outPath, bytes);
console.log(`[fixtures] wrote ${outPath}`);

