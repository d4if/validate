import { getValue, hide, onChange, onClick, setInner, show } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/element.min.js";
import { getLocal, setLocal } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/storage.min.js";
import { getHash, getQueryString, onHashChange } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/url.min.js";
import { toastError, toastInfo, toastSuccess, toastWarning } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/toast.min.js";
import { renderQR } from "https://cdn.jsdelivr.net/gh/crootjs/lib@0.0.42/qr.min.js";
import { BUILTIN_PUBLIC_KEYS } from "./keys.js";
import { createSampleSignedToken, readUntrustedKid, sha256ArrayBuffer, verifyPasetoV4Public } from "./paseto.js";

const SAVED_KEYS_STORAGE = "d4if-validate-saved-keys";
const THEME_KEY = "d4if-color-mode";

let activeStream = null;
let scanFrameId = null;
let lastDocHash = null;
let lastDocName = null;
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

function loadSavedKeys() {
    const raw = getLocal(SAVED_KEYS_STORAGE);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeSavedKeys(keys) {
    setLocal(SAVED_KEYS_STORAGE, JSON.stringify(keys));
}

function renderSavedKeysSelect() {
    const select = document.getElementById("saved-keys-select");
    if (!select) return;
    const keys = loadSavedKeys();
    const currentVal = select.value;

    select.innerHTML = '<option value="">-- Pilih kunci tersimpan --</option>' +
        keys.map((entry, idx) => `<option value="${idx}">${escapeHTML(entry.label)}</option>`).join("");

    if (currentVal !== "" && keys[Number(currentVal)]) {
        select.value = currentVal;
        document.getElementById("delete-key-btn").hidden = false;
    } else {
        document.getElementById("delete-key-btn").hidden = true;
    }
}

function saveCurrentKey() {
    const keyVal = getValue("public-key-input").trim();
    const labelVal = getValue("key-label-input").trim() || `Kunci ${new Date().toLocaleDateString("id-ID")}`;
    if (!keyVal) {
        toastWarning("Isi public key terlebih dahulu sebelum menyimpan.", 2500);
        return;
    }
    const keys = loadSavedKeys().filter((k) => k.key !== keyVal);
    keys.unshift({ label: labelVal, key: keyVal });
    writeSavedKeys(keys);
    renderSavedKeysSelect();
    document.getElementById("saved-keys-select").value = "0";
    document.getElementById("delete-key-btn").hidden = false;
    toastSuccess(`Public key "${labelVal}" disimpan.`, 2200);
}

function handleSavedKeySelect(el) {
    const idx = el.value;
    const deleteBtn = document.getElementById("delete-key-btn");
    if (idx === "") {
        deleteBtn.hidden = true;
        return;
    }
    const keys = loadSavedKeys();
    const chosen = keys[Number(idx)];
    if (chosen) {
        document.getElementById("public-key-input").value = chosen.key;
        document.getElementById("key-label-input").value = chosen.label;
        deleteBtn.hidden = false;
    }
}

function deleteSelectedKey() {
    const select = document.getElementById("saved-keys-select");
    if (select.value === "") return;
    const keys = loadSavedKeys();
    keys.splice(Number(select.value), 1);
    writeSavedKeys(keys);
    select.value = "";
    renderSavedKeysSelect();
    toastInfo("Public key tersimpan dihapus.", 2000);
}

function resolveCandidateKeys(tokenInput) {
    if (overridePublicKey && overridePublicKey.key) {
        return [overridePublicKey];
    }

    const manualKey = getValue("public-key-input").trim();
    if (manualKey) {
        return [{ id: "manual", label: "Kunci Input", key: manualKey }];
    }

    const kid = readUntrustedKid(tokenInput);
    const saved = loadSavedKeys().map((entry, idx) => ({
        id: `saved-${idx}`,
        label: entry.label || "Kunci Tersimpan",
        key: entry.key
    }));

    const combined = [...BUILTIN_PUBLIC_KEYS, ...saved];
    if (!kid) {
        return combined;
    }

    const exact = combined.filter((entry) => entry.id === kid);
    const rest = combined.filter((entry) => entry.id !== kid);
    return [...exact, ...rest];
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
    document.getElementById("result-placeholder").hidden = true;
    document.getElementById("result-panel").hidden = false;

    const banner = document.getElementById("status-banner");
    banner.className = "alert danger";
    banner.innerHTML = `<span class="icon icon-warning" aria-hidden="true"></span> <strong>Verifikasi Gagal:</strong> ${escapeHTML(message)}`;

    document.getElementById("hash-banner").hidden = true;
    setInner("claims-meta", "");
    document.getElementById("qr-preview-wrap").hidden = true;
    setInner("raw-json-output", "");
}

function updateHashBanner(claims) {
    const hashBanner = document.getElementById("hash-banner");
    if (!lastDocHash) {
        hashBanner.hidden = true;
        return;
    }

    const expected = claims && typeof claims.doc_hash === "string" ? claims.doc_hash.toLowerCase() : null;
    hashBanner.hidden = false;

    if (!expected) {
        hashBanner.className = "alert warning";
        hashBanner.innerHTML = `<span class="icon icon-warning" aria-hidden="true"></span> <strong>Catatan Integritas:</strong> Token tidak memuat klaim <code>doc_hash</code>. Hash berkas <code>${escapeHTML(lastDocName)}</code>: <code>${escapeHTML(lastDocHash)}</code>.`;
        return;
    }

    if (expected === lastDocHash.toLowerCase()) {
        hashBanner.className = "alert success";
        hashBanner.innerHTML = `<span class="icon icon-check" aria-hidden="true"></span> <strong>Integritas Berkas Cocok:</strong> SHA-256 berkas <code>${escapeHTML(lastDocName)}</code> identik dengan tanda tangan digital.`;
    } else {
        hashBanner.className = "alert danger";
        hashBanner.innerHTML = `<span class="icon icon-warning" aria-hidden="true"></span> <strong>Integritas Berkas Tidak Cocok:</strong> Berkas <code>${escapeHTML(lastDocName)}</code> telah berubah atau bukan dokumen yang ditandatangani.`;
    }
}

async function runVerification() {
    const token = getValue("token-input");
    const expectedFooter = getValue("footer-input");
    const implicitAssertion = getValue("implicit-input");
    const candidates = resolveCandidateKeys(token);

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
                const attempt = await verifyPasetoV4Public(token, candidate.key, {
                    expectedFooter,
                    implicitAssertion
                });
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

        document.getElementById("result-placeholder").hidden = true;
        document.getElementById("result-panel").hidden = false;

        const banner = document.getElementById("status-banner");
        if (!matchedResult) {
            banner.className = "alert danger";
            banner.innerHTML = '<span class="icon icon-warning" aria-hidden="true"></span> <strong>Tanda Tangan Tidak Valid:</strong> Signature Ed25519 tidak cocok dengan public key resmi atau token telah dimodifikasi.';
            document.getElementById("hash-banner").hidden = true;
            setInner("claims-meta", "");
            document.getElementById("qr-preview-wrap").hidden = true;
            setInner("raw-json-output", "");
            toastError("Tanda tangan PASETO tidak valid.", 3000);
            return;
        }

        if (!matchedResult.timeValid) {
            banner.className = "alert warning";
            banner.innerHTML = `<span class="icon icon-clock" aria-hidden="true"></span> <strong>Signature Valid, Namun Status Waktu Bermasalah:</strong> ${escapeHTML(matchedResult.timeIssues.join(" "))}`;
            toastWarning("Signature cocok, namun token kedaluwarsa atau belum berlaku.", 3500);
        } else {
            banner.className = "alert success";
            banner.innerHTML = '<span class="icon icon-check" aria-hidden="true"></span> <strong>Tanda Tangan Digital Valid:</strong> Token PASETO <code>v4.public</code> terverifikasi secara kriptografis.';
            toastSuccess("Tanda tangan digital valid.", 2200);
        }

        updateHashBanner(matchedResult.claims);
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
        document.getElementById("token-input").value = code.data;
        toastSuccess("QR Code berhasil dibaca dari gambar.", 2200);
        await runVerification();
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
    setInner("camera-toggle-btn", '<span class="icon icon-search" aria-hidden="true"></span>Pindai Kamera');
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
        document.getElementById("token-input").value = code.data;
        stopCamera();
        toastSuccess("QR Code berhasil dipindai dari kamera.", 2200);
        runVerification();
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

async function handleDocumentFileChange(el) {
    const file = el.files && el.files[0];
    if (!file) {
        lastDocHash = null;
        lastDocName = null;
        setInner("doc-hash-status", 'Jika dipilih, hash SHA-256 berkas akan dicocokkan dengan klaim <code>doc_hash</code> di dalam token.');
        return;
    }
    const buffer = await file.arrayBuffer();
    lastDocHash = await sha256ArrayBuffer(buffer);
    lastDocName = file.name;
    setInner("doc-hash-status", `SHA-256 <code>${escapeHTML(file.name)}</code>: <code>${escapeHTML(lastDocHash)}</code>`);
}

async function loadSample() {
    const sample = await createSampleSignedToken();
    overridePublicKey = {
        id: "sample",
        label: "Contoh Uji Lokal (Sementara)",
        key: sample.publicKey
    };
    document.getElementById("token-input").value = sample.token;
    document.getElementById("footer-input").value = "d4if-sample";
    document.getElementById("implicit-input").value = "";
    toastInfo("Contoh token uji lokal dimuat.", 2000);
    await runVerification();
}

function resetForm() {
    stopCamera();
    document.getElementById("validate-form").reset();
    overridePublicKey = null;
    lastDocHash = null;
    lastDocName = null;
    setInner("doc-hash-status", 'Jika dipilih, hash SHA-256 berkas akan dicocokkan dengan klaim <code>doc_hash</code> di dalam token.');
    document.getElementById("result-placeholder").hidden = false;
    document.getElementById("result-panel").hidden = true;
}

function hydrateFromUrl() {
    const query = getQueryString();
    const rawHash = getHash();
    const hashParams = new URLSearchParams(rawHash);
    const directHashToken = rawHash.startsWith("v4.public.") ? rawHash : null;
    const tokenParam = hashParams.get("token") || query.token || directHashToken;
    const keyParam = hashParams.get("key") || query.key;

    if (keyParam) {
        overridePublicKey = {
            id: "url-param",
            label: "Public Key Parameter URL",
            key: keyParam
        };
        document.getElementById("public-key-input").value = keyParam;
    } else {
        overridePublicKey = null;
    }

    if (tokenParam) {
        document.getElementById("token-input").value = tokenParam;
        runVerification();
    }
}

function init() {
    applyColorMode(getLocal(THEME_KEY));
    renderSavedKeysSelect();

    onClick("theme-toggle", toggleColorMode);
    onClick("save-key-btn", saveCurrentKey);
    onClick("delete-key-btn", deleteSelectedKey);
    onClick("camera-toggle-btn", toggleCamera);
    onClick("load-sample-btn", loadSample);
    onClick("reset-btn", resetForm);

    onChange("saved-keys-select", handleSavedKeySelect);
    onChange("qr-file-input", handleQrImageUpload);
    onChange("doc-file-input", handleDocumentFileChange);

    document.getElementById("token-input").addEventListener("input", () => {
        if (overridePublicKey && overridePublicKey.id === "sample") {
            overridePublicKey = null;
            document.getElementById("footer-input").value = "";
        }
    });

    document.getElementById("validate-form").addEventListener("submit", (event) => {
        event.preventDefault();
        runVerification();
    });

    onHashChange(() => {
        hydrateFromUrl();
    });

    hydrateFromUrl();
}

init();
