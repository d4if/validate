import { getPublicKeyAsync, signAsync, utils, verifyAsync } from "https://cdn.jsdelivr.net/npm/@noble/ed25519@2.2.3/+esm";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const PASETO_V4_PUBLIC_HEADER = "v4.public.";

export function base64UrlDecode(str) {
    if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) {
        throw new Error("String Base64URL tidak valid.");
    }
    const padLength = (4 - (str.length % 4)) % 4;
    const base64 = str.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padLength);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function base64UrlEncode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function hexToBytes(hex) {
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
        throw new Error("Format hex tidak valid.");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

export function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parsePublicKey(input) {
    const trimmed = String(input || "").trim();
    if (!trimmed) {
        throw new Error("Public key wajib diisi.");
    }

    let keyBytes;
    if (trimmed.startsWith("k4.public.")) {
        keyBytes = base64UrlDecode(trimmed.slice("k4.public.".length));
    } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        keyBytes = hexToBytes(trimmed);
    } else {
        keyBytes = base64UrlDecode(trimmed);
    }

    if (keyBytes.length !== 32) {
        throw new Error(`Panjang public key Ed25519 harus 32 byte (ditemukan ${keyBytes.length} byte).`);
    }
    return keyBytes;
}

function le64(n) {
    const buf = new Uint8Array(8);
    let val = BigInt(n);
    for (let i = 0; i < 8; i++) {
        buf[i] = Number(val & 0xffn);
        val >>= 8n;
    }
    buf[7] &= 0x7f;
    return buf;
}

// Pre-Authentication Encoding (PAE) sesuai spesifikasi PASETO v4
export function pae(pieces) {
    const chunks = [le64(pieces.length)];
    let total = 8;
    for (const piece of pieces) {
        const lenBuf = le64(piece.length);
        chunks.push(lenBuf, piece);
        total += 8 + piece.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

export function extractTokenString(rawInput) {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) {
        throw new Error("Token PASETO wajib diisi.");
    }
    if (trimmed.startsWith(PASETO_V4_PUBLIC_HEADER)) {
        return trimmed;
    }
    const match = trimmed.match(/(?:[?#&]|^)token=([^&#\s]+)/);
    if (match) {
        const decoded = decodeURIComponent(match[1]).trim();
        if (decoded.startsWith(PASETO_V4_PUBLIC_HEADER)) {
            return decoded;
        }
    }
    const hashTokenMatch = trimmed.match(/#(v4\.public\.[^&#\s]+)/);
    if (hashTokenMatch) {
        return decodeURIComponent(hashTokenMatch[1]).trim();
    }
    throw new Error("Input harus berupa token v4.public.* atau URL yang mengandung parameter token=v4.public.*");
}

export function readUntrustedKid(tokenInput) {
    try {
        const token = extractTokenString(tokenInput);
        const parts = token.split(".");
        if (parts.length !== 4) return null;
        const footerText = decoder.decode(base64UrlDecode(parts[3])).trim();
        if (!footerText.startsWith("{")) return footerText || null;
        const parsed = JSON.parse(footerText);
        return parsed && typeof parsed.kid === "string" ? parsed.kid : null;
    } catch {
        return null;
    }
}

function checkTemporalClaims(claims, nowMs = Date.now()) {
    const issues = [];
    if (typeof claims.nbf === "string") {
        const nbfMs = Date.parse(claims.nbf);
        if (Number.isNaN(nbfMs)) {
            issues.push("Klaim nbf tidak valid.");
        } else if (nowMs < nbfMs) {
            issues.push(`Token belum berlaku hingga ${claims.nbf}.`);
        }
    }
    if (typeof claims.exp === "string") {
        const expMs = Date.parse(claims.exp);
        if (Number.isNaN(expMs)) {
            issues.push("Klaim exp tidak valid.");
        } else if (nowMs >= expMs) {
            issues.push(`Token telah kedaluwarsa pada ${claims.exp}.`);
        }
    }
    return issues;
}

export async function verifyPasetoV4Public(tokenInput, publicKeyInput, options = {}) {
    const token = extractTokenString(tokenInput);
    const parts = token.split(".");
    if (parts.length !== 3 && parts.length !== 4) {
        throw new Error("Struktur token PASETO v4.public tidak valid.");
    }
    if (parts[0] !== "v4" || parts[1] !== "public") {
        throw new Error("Hanya token berjenis v4.public yang didukung.");
    }

    const publicKeyBytes = parsePublicKey(publicKeyInput);
    const payloadAndSig = base64UrlDecode(parts[2]);
    if (payloadAndSig.length < 64) {
        throw new Error("Payload token terlalu pendek untuk memuat signature Ed25519.");
    }

    const messageBytes = payloadAndSig.slice(0, payloadAndSig.length - 64);
    const sigBytes = payloadAndSig.slice(payloadAndSig.length - 64);
    const footerBytes = parts.length === 4 ? base64UrlDecode(parts[3]) : new Uint8Array(0);
    const footerText = footerBytes.length > 0 ? decoder.decode(footerBytes) : "";

    const expectedFooter = String(options.expectedFooter || "").trim();
    if (expectedFooter && footerText !== expectedFooter) {
        let matchedKid = false;
        try {
            const parsedFooter = JSON.parse(footerText);
            if (parsedFooter && parsedFooter.kid === expectedFooter) {
                matchedKid = true;
            }
        } catch {
            matchedKid = false;
        }
        if (!matchedKid) {
            throw new Error("Footer token tidak sesuai dengan footer yang diharapkan.");
        }
    }

    const implicitBytes = encoder.encode(options.implicitAssertion || "");
    const m2 = pae([
        encoder.encode(PASETO_V4_PUBLIC_HEADER),
        messageBytes,
        footerBytes,
        implicitBytes
    ]);

    const signatureValid = await verifyAsync(sigBytes, m2, publicKeyBytes);
    if (!signatureValid) {
        return {
            valid: false,
            signatureValid: false,
            timeValid: false,
            timeIssues: [],
            claims: null,
            footer: footerText || null,
            rawToken: token,
            publicKeyPaserk: "k4.public." + base64UrlEncode(publicKeyBytes)
        };
    }

    let claims;
    try {
        claims = JSON.parse(decoder.decode(messageBytes));
    } catch {
        throw new Error("Payload token terverifikasi bukan JSON yang valid.");
    }

    const timeIssues = checkTemporalClaims(claims);
    const timeValid = timeIssues.length === 0;

    return {
        valid: signatureValid && timeValid,
        signatureValid,
        timeValid,
        timeIssues,
        claims,
        footer: footerText || null,
        rawToken: token,
        publicKeyPaserk: "k4.public." + base64UrlEncode(publicKeyBytes)
    };
}

export async function sha256ArrayBuffer(buffer) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return bytesToHex(new Uint8Array(hashBuffer));
}

export async function createSampleSignedToken() {
    const privKey = utils.randomPrivateKey();
    const pubKey = await getPublicKeyAsync(privKey);
    const now = new Date();
    const claims = {
        iss: "Prodi D4TI ULBI (Contoh Uji Lokal)",
        sub: "Contoh Validasi Tanda Tangan Digital",
        jti: "SAMPLE-2026-001",
        signer: "NN257L",
        doc_name: "contoh-dokumen.txt",
        doc_alg: "sha256",
        doc_size: 42,
        doc_hash: "0000000000000000000000000000000000000000000000000000000000000000",
        iat: now.toISOString(),
        nbf: now.toISOString(),
        sample: true
    };
    const messageBytes = encoder.encode(JSON.stringify(claims));
    const footerBytes = encoder.encode(JSON.stringify({ kid: "d4if-sample" }));
    const m2 = pae([
        encoder.encode(PASETO_V4_PUBLIC_HEADER),
        messageBytes,
        footerBytes,
        new Uint8Array(0)
    ]);
    const sig = await signAsync(m2, privKey);
    const body = new Uint8Array(messageBytes.length + sig.length);
    body.set(messageBytes, 0);
    body.set(sig, messageBytes.length);

    return {
        publicKey: "k4.public." + base64UrlEncode(pubKey),
        token: `${PASETO_V4_PUBLIC_HEADER}${base64UrlEncode(body)}.${base64UrlEncode(footerBytes)}`
    };
}
