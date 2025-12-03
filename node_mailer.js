const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "bruno.jose@aluno.ufop.edu.br",
        pass: "leie egnw epuv xqoc"
    }
});

async function sendMail(to, subject, html) {
    return transporter.sendMail({
        from: "bruno.jose@aluno.ufop.edu.br",
        to,
        subject,
        html
    });
}

module.exports = { sendMail };
