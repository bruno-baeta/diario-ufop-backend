const express = require("express");
const multer = require("multer");
const pdf2table = require("pdf2table");
const { sendMail } = require("./node_mailer");

const upload = multer();
const app = express();

const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/* ============================================================
   1) ORDENA OS BLOCO POR POSIÇÃO Y
============================================================ */
function sortRowsByY(rowsdebug) {
    const blocks = rowsdebug[0];

    return blocks
        .map(b => ({
            y: b.y,
            texts: b.data.map(d => d.text),
            xs: b.data.map(d => d.x)
        }))
        .sort((a, b) => a.y - b.y);
}

/* ============================================================
   2) CONSTRÓI A TABELA  (tempo + Segunda..Sábado)
============================================================ */
function buildTable(sorted) {
    const header = sorted.find(r => r.texts.includes("Segunda"));
    const colXs = header.xs;

    const table = [];

    for (const row of sorted) {
        if (!/\d{2}:\d{2}/.test(row.texts[0])) continue;

        const time = row.texts[0];
        const cols = ["", "", "", "", "", ""];

        row.texts.slice(1).forEach((text, i) => {
            const x = row.xs[i + 1];
            let colIndex = 0;

            for (let c = 1; c < colXs.length; c++) {
                if (x >= colXs[c - 1] && x < colXs[c]) {
                    colIndex = c - 1;
                    break;
                }
                if (c === colXs.length - 1) colIndex = c;
            }

            cols[colIndex] = text;
        });

        table.push([time, ...cols]);
    }

    return table;
}

/* ============================================================
   3) EXTRAÇÃO DO NOME DAS MATÉRIAS
============================================================ */
function extractSubjectNames(rows) {
    const map = {};

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        if (row[0] === "Código") {
            for (let j = i + 1; j < rows.length; j++) {
                const line = rows[j];
                if (!/^[A-Z]{3}\d{3}$/.test(line[0])) break;

                const code = line[0];
                const name = line[2];

                map[code] = name;
            }
        }
    }

    return map;
}

/* ============================================================
   4) MERGE TIMES (FUSÃO DE HORÁRIOS CONTÍNUOS)
============================================================ */
function mergeTimes(schedules) {
    function parse(t) {
        let [start, end] = t.split(" - ");
        return { start, end };
    }

    function toMinutes(hhmm) {
        const [h, m] = hhmm.split(":").map(Number);
        return h * 60 + m;
    }

    function toHHMM(min) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    // AGRUPAR POR DIA
    const byDay = {};

    for (const s of schedules) {
        const { start, end } = parse(s.time);
        const startMin = toMinutes(start);
        const endMin = toMinutes(end);

        if (!byDay[s.day]) {
            byDay[s.day] = { startMin, endMin };
        } else {
            // pega o menor início e maior fim
            byDay[s.day].startMin = Math.min(byDay[s.day].startMin, startMin);
            byDay[s.day].endMin = Math.max(byDay[s.day].endMin, endMin);
        }
    }

    // TRANSFORMAR EM LISTA
    return Object.keys(byDay).map(day => ({
        day,
        time: `${toHHMM(byDay[day].startMin)}`
    }));
}


function getMaxAbsences(credits) {
    const map = {
        15: 2,
        30: 4,
        45: 6,
        60: 9,
        75: 11,
        90: 13,
        120: 18,
        150: 22
    };

    return map[credits] ?? 0;
}

/* ============================================================
   5) EXTRAÇÃO DOS HORÁRIOS DA TABELA
============================================================ */
function extractSchedules(table) {
    const result = {};

    for (const row of table) {
        const time = row[0];

        for (let i = 1; i <= 6; i++) {
            const cell = row[i];
            if (!cell) continue;

            const matches = cell.match(/[A-Z]{3}\d{3}/g);
            if (!matches) continue;

            for (const code of matches) {
                result[code] ||= [];
                result[code].push({
                    day: DAYS[i - 1],
                    time
                });
            }
        }
    }

    return result;
}

/* ============================================================
   6) MONTAR JSON FINAL
============================================================ */
function buildFinal(schedules, names) {
    const final = [];

    for (const code of Object.keys(schedules)) {

        // 1️⃣ Contar quadradinhos reais (cada ocorrência = 15 créditos)
        const realCredits = schedules[code].length * 15;

        // 2️⃣ Calcular faltas permitidas com base nos créditos REAIS
        const maxAbsences = getMaxAbsences(realCredits);

        // 3️⃣ Merge para exibir melhor
        const merged = mergeTimes(schedules[code]);

        final.push({
            code,
            name: names[code] ?? code,
            credits: realCredits,
            maxAbsences,
            weekSchedules: merged.length,
            schedules: merged
        });
    }

    return final;
}

function extractStudentInfo(rows) {
    const text = rows
        .map(row =>
            row
                .map(cell => {
                    if (typeof cell === "string") return cell;
                    if (typeof cell === "number") return String(cell);
                    if (cell && typeof cell.text === "string") return cell.text;
                    return ""; // fallback seguro
                })
                .join(" ")
        )
        .join(" ");

    const nameMatch = text.match(/Atestamos que\s+(.+?)\s+matr[ií]cula/i);
    const rgMatch = text.match(/Registro de Identidade nº?\s+([\d\.-]+-[A-Z]+)/i);

    return {
        name: nameMatch?.[1] ?? null,
        rg: rgMatch?.[1] ?? null
    };
}

function buildEmailHTML(student, result) {
    return `
<div style="font-family:Arial, sans-serif; font-size:14px;">
    <h2 style="margin:0 0 16px 0;">Novo Atestado de Matrícula Recebido 📘</h2>

    <p><b>Aluno:</b> ${student.name}</p>
    <p><b>RG:</b> ${student.rg}</p>

    <h3 style="margin-top:20px;">Disciplinas Encontradas</h3>

    <table cellpadding="6" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        ${result.map(r => `
        <tr>
            <td style="border-bottom:1px solid #ddd;">
                <b>${r.code}</b> — ${r.name}<br>
                Créditos: ${r.credits} | Faltas Máx: ${r.maxAbsences}
            </td>
        </tr>`).join("")}
    </table>

    <h3 style="margin-top:20px;">Horários (JSON)</h3>

    <pre style="background:#f4f4f4; padding:12px; border-radius:6px; white-space:pre-wrap;">
${JSON.stringify(result, null, 2)}
    </pre>

    <p style="color:#777;">Enviado automaticamente pelo backend</p>
</div>
`;
}

/* ============================================================
   7) ROTA FINAL
============================================================ */
app.post("/parse", upload.single("file"), async (req, res) => {
    pdf2table.parse(req.file.buffer, async (err, rows, rowsdebug) => {
        if (err) return res.status(500).json({ error: err.toString() });

        const sorted = sortRowsByY(rowsdebug);
        const table = buildTable(sorted);
        const names = extractSubjectNames(rows);
        const schedules = extractSchedules(table);
        const result = buildFinal(schedules, names);

        const student = extractStudentInfo(rows);

        await sendMail(
            "jbruno356@gmail.com",
            `Novo upload — ${student.name}`,
            buildEmailHTML(student, result)
        );

        return res.json(result);
    });
});

/* ============================================================
   8) START SERVER
============================================================ */
app.listen(3000, () => console.log("🔥 Server rodando em http://localhost:3000"));
