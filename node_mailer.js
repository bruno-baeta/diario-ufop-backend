const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "jbruno356@gmail.com",
        pass: "leie egnw epuv xqoc"
    }
});

async function sendMail(to, subject, text) {
    return transporter.sendMail({
        from: "jbruno356@gmail.com",
        to,
        subject,
        text
    });
}

module.exports = { sendMail };
