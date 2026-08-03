/**
 * Gerador de ícones do PWA — Delvor.
 *
 * Fonte: `public/delvor-mark.svg` (mesmo path do <BrandLogo> React).
 * Se quiser evoluir a marca, edita esse SVG e roda `npm run icons` de novo.
 *
 * Como usar:
 *   1. Confirma que `public/delvor-mark.svg` está atualizado
 *   2. Roda: `npm run icons`
 *   3. **Importante no Android:** desinstale o PWA atual do celular e
 *      reinstale (Android cacheia ícones agressivamente — sem isso você
 *      vê o ícone antigo mesmo depois de atualizar)
 *
 * Filosofia de ícones:
 *   - "any" (Chrome, splash, fallback): fundo TRANSPARENTE com logo grande.
 *     Assim o sistema usa o `background_color` do manifest pra preencher.
 *   - "maskable" (Android Adaptive): fundo CHEIO com cor da marca + logo
 *     centralizado com safe-zone de 20%. Não importa o formato (círculo,
 *     squircle, etc.) — sempre fica bonito.
 *   - apple-touch-icon: fundo da marca + logo (iOS não suporta maskable).
 */
import sharp from "sharp";
import { writeFile, access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const publicDir = resolve(root, "public");
const sourceFile = resolve(publicDir, "delvor-mark.svg");

// Cor de fundo do círculo da marca — usada em maskable + apple-touch + og.
// Blue-900 combina com o gradiente do mark (do azul claro pro navy escuro).
const BRAND_BG = { r: 30, g: 58, b: 138 }; // #1e3a8a (blue-900)

async function ensureSource() {
  try {
    await access(sourceFile, constants.R_OK);
  } catch {
    console.error("");
    console.error("❌  Arquivo não encontrado:");
    console.error(`    ${sourceFile}`);
    console.error("");
    console.error("    Salve o SVG do mark aí com esse nome exato e rode de novo.");
    console.error("    Use o path do <BrandLogo> React como fonte pra manter tudo sincronizado.");
    console.error("");
    process.exit(1);
  }
}

/**
 * Renderiza o SVG source num buffer PNG quadrado 1024×1024 (com transparência).
 * Sharp rasteriza SVG nativamente — não precisa de headless browser.
 */
async function buildSquareLogo() {
  const svgBuffer = await readFile(sourceFile);

  // Rasteriza em alta resolução (1024) — depois as demais funções fazem
  // downscale com kernel lanczos3 (mantém nitidez).
  const RENDER_SIZE = 1024;
  const rendered = await sharp(svgBuffer, { density: 300 })
    .resize(RENDER_SIZE, RENDER_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return { buffer: rendered, originalSize: RENDER_SIZE };
}

/**
 * Cria um ícone "transparente" — logo num canvas transparente, padding pequeno.
 * Usado pra "any" — o sistema (Chrome, splash) usa o background_color do manifest.
 */
async function makeTransparentIcon(squareLogo, size, padding = 0.08) {
  const logoSize = Math.round(size * (1 - padding * 2));
  const offset = Math.round((size - logoSize) / 2);
  const logo = await sharp(squareLogo)
    .resize(logoSize, logoSize, { fit: "contain", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: logo, top: offset, left: offset }]);
}

/**
 * Cria um ícone "branded" — fundo cheio da cor da marca + logo centralizado.
 * Usado pra apple-touch (iOS sempre mostra ícone com fundo, sem máscara)
 * e maskable (Android Adaptive Icon recorta — precisa de safe zone).
 *
 * @param padding 0.1 = 10% de cada lado vazio (logo ocupa 80%)
 *                0.2 = 20% safe-zone (recomendado pra maskable)
 */
async function makeBrandedIcon(squareLogo, size, padding = 0.1) {
  const logoSize = Math.round(size * (1 - padding * 2));
  const offset = Math.round((size - logoSize) / 2);
  const logo = await sharp(squareLogo)
    .resize(logoSize, logoSize, { fit: "contain", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_BG },
  }).composite([{ input: logo, top: offset, left: offset }]);
}

/**
 * og-image — banner 1200×630 com fundo violet + logo centralizado grande.
 */
async function buildOgImage(squareLogo) {
  const logoSize = 480;
  const logo = await sharp(squareLogo)
    .resize(logoSize, logoSize, { fit: "contain", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 1200, height: 630, channels: 4, background: BRAND_BG },
  }).composite([
    {
      input: logo,
      top: Math.round((630 - logoSize) / 2),
      left: Math.round((1200 - logoSize) / 2),
    },
  ]);
}

async function save(builder, name) {
  const out = resolve(publicDir, name);
  const buf = await builder.png({ compressionLevel: 9, palette: false }).toBuffer();
  await writeFile(out, buf);
  console.log(`  ✓ public/${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  await ensureSource();
  console.log("");
  console.log("🎨  Processando imagem-fonte...");

  const { buffer: squareLogo, originalSize } = await buildSquareLogo();
  console.log(`     Logo extraído: ${originalSize}×${originalSize}px (após auto-trim)`);
  console.log("");
  console.log("📦  Gerando ícones...");
  console.log("");

  // ─── Favicons (mostrados em abas de browser) ─────────────────────────
  // Pequenos demais pra ter fundo da marca — usa logo transparente.
  await save(await makeTransparentIcon(squareLogo, 16, 0.02), "favicon-16x16.png");
  await save(await makeTransparentIcon(squareLogo, 32, 0.02), "favicon-32x32.png");
  await save(await makeTransparentIcon(squareLogo, 32, 0.02), "favicon.ico"); // PNG simplificado

  // ─── Apple Touch Icon (iOS) ──────────────────────────────────────────
  // iOS sempre mostra com cantos arredondados, sem mascarar. Usa branded.
  await save(await makeBrandedIcon(squareLogo, 180, 0.12), "apple-touch-icon.png");

  // ─── "any" — Chrome, splash, fallback ────────────────────────────────
  // Transparente. O background_color do manifest preenche.
  await save(await makeTransparentIcon(squareLogo, 192, 0.08), "android-chrome-192x192.png");
  await save(await makeTransparentIcon(squareLogo, 512, 0.08), "android-chrome-512x512.png");

  // ─── "maskable" — Android Adaptive Icons ─────────────────────────────
  // Fundo da marca + 20% safe-zone (Android recorta no formato do sistema).
  await save(await makeBrandedIcon(squareLogo, 192, 0.2), "maskable-icon-192x192.png");
  await save(await makeBrandedIcon(squareLogo, 512, 0.2), "maskable-icon-512x512.png");

  // ─── og-image — preview em redes ─────────────────────────────────────
  await save(await buildOgImage(squareLogo), "og-image.png");

  console.log("");
  console.log("✅  Ícones gerados com sucesso!");
  console.log("");
  console.log("📱  Próximos passos:");
  console.log("    1. npm run build");
  console.log("    2. Deploy");
  console.log("    3. *** No Android, DESINSTALE o PWA e reinstale ***");
  console.log("       O sistema cacheia o ícone agressivamente — sem reinstalar,");
  console.log("       você continua vendo o ícone antigo.");
  console.log("");
}

main().catch((err) => {
  console.error("Erro gerando ícones:", err);
  process.exit(1);
});
