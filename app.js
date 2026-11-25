import { hide, onChange, onClick, setInner, show } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/element.min.js";
import { getLocal, setLocal } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/storage.min.js";
import { getHash, getQueryString, onHashChange } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/url.min.js";
import { toastError, toastInfo, toastSuccess, toastWarning } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/toast.min.js";
import { renderQR } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/qr.min.js";
import { BUILTIN_PUBLIC_KEYS } from "./keys.js";
import { hasSingleIncrementalEof, readUntrustedKid, sha256ArrayBuffer, verifyPasetoV4Public } from "./paseto.js";

const THEME_KEY = "d4if-color-mode";

const LECTURER_NAMES = {
    RAN: "Roni Andarsyah, S.T., M.Kom.",
    MYH: "M. Yusril Helmi Setyawan, S.Kom., M.Kom.",
    RMA: "Rolly Maulana Awangga, S.T., M.T., CAIP.",
    MNF: "Dr. Mohamad Nurkamal Fauzan, S.T., M.T.",
    CPY: "Cahyo Prianto, S.Pd., M.T.",
    SFP: "Dr. Syafrial Fachri Pane, S.T., M.T.I., EBDP., CDSP.",
    RHA: "Roni Habibi, S.Kom., M.T.",
    NHH: "Nisa Hanum Harani, S.Kom., M.T., CDSP.",
    RNS: "Rd. Nuraini Siti Fathonah, S.S., M.Hum.",
    NN257L: "Rolly Maulana Awangga, S.T., M.T., CAIP."
};

let activeStream = null;
let scanFrameId = null;
let lastDocBuffer = null;
let lastDocHash = null;
let lastDocName = null;
let lastVerifiedClaims = null;
let currentTokenInput = "";
let overridePublicKey = null;

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function applyColorMode(mode) {
    if (mode === "dark" || mode === "light") {
        document.documentElement.setAttribute("data-theme", mode);
    } else {
        document.documentElement.removeAttribute("data-theme");
    }
    const label = mode === "dark" ? "Mode Terang" : mode === "light" ? "Mode Gelap" : "Mode Tampilan";
    setInner("theme-toggle", label);
}

function toggleColorMode() {
    const current = getLocal(THEME_KEY);
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDarkNow = current === "dark" || (!current && prefersDark);
    const next = isDarkNow ? "light" : "dark";
    setLocal(THEME_KEY, next);
    applyColorMode(next);
}

function resolveCandidateKeys(tokenInput) {
    if (overridePublicKey && overridePublicKey.key) {
        return [overridePublicKey];
    }

    const kid = readUntrustedKid(tokenInput);
    if (!kid) {
        return BUILTIN_PUBLIC_KEYS;
    }

    const exact = BUILTIN_PUBLIC_KEYS.filter((entry) => entry.id === kid);
    const rest = BUILTIN_PUBLIC_KEYS.filter((entry) => entry.id !== kid);
    return [...exact, ...rest];
}

function formatIndonesianTimestamp(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return String(isoString);

    const dayDate = new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(date);

    const time = new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date);

    return `${dayDate} pukul ${time.replace(":", ".")}`;
}

function renderSignerCard(claims) {
    const hashCard = document.getElementById("hash-card");
    const hashLabel = document.getElementById("hash-card-label");
    const hashValue = document.getElementById("hash-value-display");
    const signerSection = document.getElementById("signer-section");
    const integritySection = document.getElementById("integrity-section");

    if (claims.doc_hash) {
        hashLabel.textContent = "Nilai Hash";
        hashValue.textContent = claims.doc_hash;
        hashCard.hidden = false;
    } else if (claims.jti) {
        hashLabel.textContent = "ID Dokumen";
        hashValue.textContent = claims.jti;
        hashCard.hidden = false;
    } else {
        hashCard.hidden = true;
    }

    const signerCode = claims.signer ? String(claims.signer).trim() : "";
    const fullName = (signerCode && LECTURER_NAMES[signerCode]) || signerCode || claims.iss || "Penanda Tangan Resmi";
    document.getElementById("signer-fullname").textContent = fullName;

    const detailRows = [];
    if (signerCode) {
        detailRows.push(["Kode Dosen", signerCode]);
    }
    if (claims.sub) {
        detailRows.push(["Perihal", claims.sub]);
    }
    if (claims.jti) {
        detailRows.push(["Nomor", claims.jti]);
    }
    if (claims.iss) {
        detailRows.push(["Instansi", claims.iss]);
    }
    if (claims.iat) {
        detailRows.push(["Ditandatangani pada", formatIndonesianTimestamp(claims.iat)]);
    }

    setInner(
        "signer-details",
        detailRows
            .map(
                ([label, value]) =>
                    `<div class="signer-row"><dt>${escapeHTML(label)}</dt><span class="colon" aria-hidden="true">:</span><dd>${escapeHTML(value)}</dd></div>`
            )
            .join("")
    );

    signerSection.hidden = false;
    integritySection.hidden = false;
}

function renderClaimsMeta(claims, footer, publicKeyPaserk, keyLabel) {
    const labels = [
        ["iss", "Penerbit (iss)"],
        ["signer", "Penanda Tangan"],
        ["jti", "ID Dokumen (jti)"],
        ["sub", "Subjek (sub)"],
        ["aud", "Penerima (aud)"],
        ["doc_name", "Nama Berkas"],
        ["doc_size", "Ukuran Berkas (byte)"],
        ["doc_base_len", "Panjang Basis PDF (byte)"],
        ["doc_hash", "Hash Dokumen (SHA-256)"],
        ["iat", "Diterbitkan (iat)"],
        ["nbf", "Berlaku Mulai (nbf)"],
        ["exp", "Kedaluwarsa (exp)"]
    ];

    const knownKeys = new Set(labels.map(([k]) => k));
    const rows = [];

    for (const [key, label] of labels) {
        if (claims[key] !== undefined && claims[key] !== null) {
            rows.push(`<div><dt>${escapeHTML(label)}</dt><dd><code>${escapeHTML(claims[key])}</code></dd></div>`);
        }
    }

    for (const [key, value] of Object.entries(claims)) {
        if (knownKeys.has(key)) continue;
        const formatted = typeof value === "object" ? JSON.stringify(value) : String(value);
        rows.push(`<div><dt>${escapeHTML(key)}</dt><dd><code>${escapeHTML(formatted)}</code></dd></div>`);
    }

    if (footer) {
        rows.push(`<div><dt>Footer</dt><dd><code>${escapeHTML(footer)}</code></dd></div>`);
    }
    if (keyLabel) {
        rows.push(`<div><dt>Otoritas Kunci</dt><dd>${escapeHTML(keyLabel)}</dd></div>`);
    }
    rows.push(`<div><dt>Public Key</dt><dd><code>${escapeHTML(publicKeyPaserk)}</code></dd></div>`);

    setInner("claims-meta", rows.join(""));
}

function showVerificationError(message) {
    document.getElementById("form-card").hidden = true;
    document.getElementById("result-panel").hidden = false;
    document.getElementById("hash-card").hidden = true;
    document.getElementById("signer-section").hidden = true;
    document.getElementById("integrity-section").hidden = true;

    const banner = document.getElementById("status-banner");
    banner.className = "alert danger";
    banner.innerHTML = `<span class="icon icon-warning" aria-hidden="true"></span> <strong>Verifikasi Gagal:</strong> ${escapeHTML(message)}`;

    document.getElementById("hash-banner").hidden = true;
    setInner("claims-meta", "");
    document.getElementById("qr-preview-wrap").hidden = true;
    setInner("raw-json-output", "");
    document.getElementById("show-form-btn").hidden = document.body.classList.contains("embed-mode");
}

async function updateHashBanner(claims) {
    const hashBanner = document.getElementById("hash-banner");
    if (!lastDocHash || !lastDocBuffer) {
        hashBanner.hidden = true;
        return;
    }

    const expected = claims && typeof claims.doc_hash === "string" ? claims.doc_hash.toLowerCase() : null;
    hashBanner.hidden = false;

    if (!expected) {
        hashBanner.className = "alert warning";
        hashBanner.innerHTML = `<span class="icon icon-warning" aria-hidden="true"></span> <strong>Catatan Integritas:</strong> QR ini tidak memuat <code>doc_hash</code>. Hash berkas <code>${escapeHTML(lastDocName)}</code>: <code>${escapeHTML(lastDocHash)}</code>.`;
        return;
    }

    if (expected === lastDocHash.toLowerCase()) {
        hashBanner.className = "alert success";
        hashBanner.innerHTML = `<span class="icon icon-check" aria-hidden="true"></span> <strong>Keaslian Berkas Terverifikasi:</strong> Berkas <code>${escapeHTML(lastDocName)}</code> cocok dengan tanda tangan digital.`;
        return;
    }

    const baseLen = claims && Number.isInteger(claims.doc_base_len) ? claims.doc_base_len : null;
    if (baseLen && baseLen > 0) {
        const bytes = new Uint8Array(lastDocBuffer);
        const isPdf = bytes.length > baseLen &&
            bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
        if (isPdf) {
            const baseHash = await sha256ArrayBuffer(bytes.subarray(0, baseLen));
            if (baseHash.toLowerCase() === expected && hasSingleIncrementalEof(bytes, baseLen)) {
                hashBanner.className = "alert success";
                hashBanner.innerHTML = `<span class="icon icon-check" aria-hidden="true"></span> <strong>Keaslian Berkas Terverifikasi:</strong> Dokumen PDF <code>${escapeHTML(lastDocName)}</code> cocok dengan nilai hash tanda tangan digital.`;
                return;
            }
        }
    }

    hashBanner.className = "alert danger";
    hashBanner.innerHTML = `<span class="icon icon-warning" aria-hidden="true"></span> <strong>Keaslian Berkas Tidak Cocok:</strong> Berkas <code>${escapeHTML(lastDocName)}</code> telah diubah atau bukan naskah yang ditandatangani.`;
}

async function runVerification(tokenInput = currentTokenInput) {
    currentTokenInput = String(tokenInput || "");
    const candidates = resolveCandidateKeys(currentTokenInput);

    if (candidates.length === 0) {
        showVerificationError("Tidak ada public key terpercaya yang tersedia di aplikasi.");
        return;
    }

    try {
        let matchedResult = null;
        let matchedCandidate = null;
        let lastError = null;

        for (const candidate of candidates) {
            try {
                const attempt = await verifyPasetoV4Public(currentTokenInput, candidate.key);
                if (attempt.signatureValid) {
                    matchedResult = attempt;
                    matchedCandidate = candidate;
                    break;
                }
            } catch (err) {
                lastError = err;
            }
        }

        if (!matchedResult && lastError) {
            throw lastError;
        }

        document.getElementById("form-card").hidden = true;
        document.getElementById("result-panel").hidden = false;
        document.getElementById("show-form-btn").hidden = document.body.classList.contains("embed-mode");

        const banner = document.getElementById("status-banner");
        if (!matchedResult) {
            lastVerifiedClaims = null;
            document.getElementById("hash-card").hidden = true;
            document.getElementById("signer-section").hidden = true;
            document.getElementById("integrity-section").hidden = true;
            banner.className = "alert danger";
            banner.innerHTML = '<span class="icon icon-warning" aria-hidden="true"></span> <strong>Tanda Tangan Tidak Valid:</strong> Signature Ed25519 tidak cocok dengan public key resmi atau token telah dimodifikasi.';
            document.getElementById("hash-banner").hidden = true;
            setInner("claims-meta", "");
            document.getElementById("qr-preview-wrap").hidden = true;
            setInner("raw-json-output", "");
            toastError("Tanda tangan PASETO tidak valid.", 3000);
            return;
        }

        lastVerifiedClaims = matchedResult.claims;

        if (!matchedResult.timeValid) {
            banner.className = "alert warning";
            banner.innerHTML = `<span class="icon icon-clock" aria-hidden="true"></span> <strong>Signature Valid, Namun Status Waktu Bermasalah:</strong> ${escapeHTML(matchedResult.timeIssues.join(" "))}`;
            toastWarning("Signature cocok, namun token kedaluwarsa atau belum berlaku.", 3500);
        } else {
            banner.className = "alert success";
            banner.innerHTML = '<span class="icon icon-check" aria-hidden="true"></span> <strong>Tanda Tangan Digital Valid:</strong> Terverifikasi kriptografis (PASETO <code>v4.public</code>).';
            toastSuccess("Tanda tangan digital valid.", 2200);
        }

        renderSignerCard(matchedResult.claims);
        await updateHashBanner(matchedResult.claims);
        renderClaimsMeta(
            matchedResult.claims,
            matchedResult.footer,
            matchedResult.publicKeyPaserk,
            matchedCandidate ? matchedCandidate.label : null
        );
        setInner("raw-json-output", escapeHTML(JSON.stringify(matchedResult.claims, null, 2)));

        try {
            renderQR("token-qr-preview", matchedResult.rawToken, { ecc: "M", margin: 2, label: "QR Code Token PASETO" });
            document.getElementById("qr-preview-wrap").hidden = false;
        } catch {
            document.getElementById("qr-preview-wrap").hidden = true;
        }
    } catch (err) {
        showVerificationError(err.message);
        toastError(err.message, 3000);
    }
}

function decodeImageDataWithJsQR(imageData) {
    if (typeof window.jsQR !== "function") {
        throw new Error("Pustaka pemindai jsQR belum termuat.");
    }
    return window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth"
    });
}

async function handleQrImageUpload(el) {
    const file = el.files && el.files[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    try {
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error("Berkas gambar QR tidak dapat dibaca."));
            img.src = objectUrl;
        });

        const canvas = document.getElementById("qr-canvas");
        const width = img.naturalWidth || 512;
        const height = img.naturalHeight || 512;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const code = decodeImageDataWithJsQR(imageData);
        if (!code || !code.data) {
            throw new Error("QR Code tidak terdeteksi pada gambar tersebut.");
        }

        overridePublicKey = null;
        toastSuccess("QR Code berhasil dibaca dari gambar.", 2200);
        await runVerification(code.data);
    } catch (err) {
        toastError(err.message, 3000);
    } finally {
        URL.revokeObjectURL(objectUrl);
        el.value = "";
    }
}

function stopCamera() {
    if (scanFrameId !== null) {
        cancelAnimationFrame(scanFrameId);
        scanFrameId = null;
    }
    if (activeStream) {
        for (const track of activeStream.getTracks()) {
            track.stop();
        }
        activeStream = null;
    }
    const video = document.getElementById("camera-video");
    video.srcObject = null;
    hide("camera-wrap");
    setInner("camera-toggle-btn", '<span class="icon icon-search" aria-hidden="true"></span>Pindai QR dengan Kamera');
}

function scanCameraFrame() {
    const video = document.getElementById("camera-video");
    if (!activeStream || video.readyState < video.HAVE_ENOUGH_DATA) {
        scanFrameId = requestAnimationFrame(scanCameraFrame);
        return;
    }

    const canvas = document.getElementById("qr-canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = decodeImageDataWithJsQR(imageData);
    if (code && code.data) {
        overridePublicKey = null;
        stopCamera();
        toastSuccess("QR Code berhasil dipindai dari kamera.", 2200);
        runVerification(code.data);
        return;
    }

    scanFrameId = requestAnimationFrame(scanCameraFrame);
}

async function toggleCamera() {
    if (activeStream) {
        stopCamera();
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toastError("Kamera tidak didukung atau diblokir oleh browser ini.", 3000);
        return;
    }
    try {
        activeStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } }
        });
        const video = document.getElementById("camera-video");
        video.srcObject = activeStream;
        await video.play();
        show("camera-wrap");
        setInner("camera-toggle-btn", '<span class="icon icon-close" aria-hidden="true"></span>Hentikan Kamera');
        scanFrameId = requestAnimationFrame(scanCameraFrame);
    } catch (err) {
        stopCamera();
        toastError(`Gagal mengakses kamera: ${err.message}`, 3000);
    }
}

async function processDocumentFile(file) {
    if (!file) {
        lastDocBuffer = null;
        lastDocHash = null;
        lastDocName = null;
        document.getElementById("result-doc-label").textContent = "Pilih berkas dokumen (PDF)";
        if (lastVerifiedClaims) await updateHashBanner(lastVerifiedClaims);
        return;
    }
    const buffer = await file.arrayBuffer();
    lastDocBuffer = buffer;
    lastDocHash = await sha256ArrayBuffer(buffer);
    lastDocName = file.name;
    document.getElementById("result-doc-label").textContent = file.name;
    if (lastVerifiedClaims) {
        await updateHashBanner(lastVerifiedClaims);
    }
}

async function handleDocumentFileChange(el) {
    const file = el.files && el.files[0];
    await processDocumentFile(file);
}

function showScannerView() {
    stopCamera();
    currentTokenInput = "";
    overridePublicKey = null;
    lastDocBuffer = null;
    lastDocHash = null;
    lastDocName = null;
    lastVerifiedClaims = null;
    document.getElementById("result-doc-file-input").value = "";
    document.getElementById("result-doc-label").textContent = "Pilih berkas dokumen (PDF)";
    document.getElementById("hash-banner").hidden = true;
    document.getElementById("result-panel").hidden = true;
    document.getElementById("form-card").hidden = false;
    document.getElementById("show-form-btn").hidden = true;
}

function hydrateFromUrl() {
    const query = getQueryString();
    const rawHash = getHash();
    const hashParams = new URLSearchParams(rawHash);
    const directHashToken = rawHash.startsWith("v4.public.") ? rawHash : null;
    const tokenParam = hashParams.get("token") || query.token || directHashToken;
    const keyParam = hashParams.get("key") || query.key;
    const isEmbed = query.embed === "1" || hashParams.get("embed") === "1";

    document.body.classList.toggle("embed-mode", Boolean(isEmbed));

    if (keyParam) {
        overridePublicKey = {
            id: "url-param",
            label: "Public Key Parameter URL",
            key: keyParam
        };
    } else {
        overridePublicKey = null;
    }

    if (tokenParam) {
        runVerification(tokenParam);
    } else {
        showScannerView();
    }
}

function wireDropzone(labelEl, onFile) {
    if (!labelEl) return;
    labelEl.addEventListener("dragover", (event) => {
        event.preventDefault();
        labelEl.classList.add("is-dragover");
    });
    labelEl.addEventListener("dragleave", () => {
        labelEl.classList.remove("is-dragover");
    });
    labelEl.addEventListener("drop", async (event) => {
        event.preventDefault();
        labelEl.classList.remove("is-dragover");
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) {
            await onFile(file);
        }
    });
}

function init() {
    applyColorMode(getLocal(THEME_KEY));

    onClick("theme-toggle", toggleColorMode);
    onClick("camera-toggle-btn", toggleCamera);
    onClick("show-form-btn", () => {
        showScannerView();
        toastInfo("Siap memindai dokumen baru.", 1800);
    });

    onChange("qr-file-input", handleQrImageUpload);
    onChange("result-doc-file-input", handleDocumentFileChange);

    wireDropzone(document.getElementById("pdf-dropzone-label"), processDocumentFile);

    onHashChange(() => {
        hydrateFromUrl();
    });

    hydrateFromUrl();
}

init();
