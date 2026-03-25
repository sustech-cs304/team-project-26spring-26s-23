import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sourcePngPath = path.join(projectRoot, 'public', 'candue_icon.png')
const outputDir = path.join(projectRoot, 'public', 'generated-icons')
const pngOutputDir = path.join(outputDir, 'png')
const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const transparentBackground = { r: 0, g: 0, b: 0, alpha: 0 }

async function assertReadableFile(filePath) {
  try {
    await access(filePath, constants.R_OK)
  } catch {
    throw new Error(`Missing readable source image: ${filePath}`)
  }
}

function assertBuffer(buffer, targetPath) {
  if (!buffer) {
    throw new Error(`Failed to generate icon asset: ${targetPath}`)
  }

  return buffer
}

async function renderSquarePng(input, size) {
  return sharp(input)
    .resize(size, size, {
      fit: 'contain',
      background: transparentBackground,
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function writePngVariants(input) {
  for (const size of pngSizes) {
    const outputPath = path.join(pngOutputDir, `${size}x${size}.png`)
    const resizedPng = await renderSquarePng(input, size)
    await writeFile(outputPath, resizedPng)
  }
}

async function main() {
  await assertReadableFile(sourcePngPath)

  await rm(outputDir, { recursive: true, force: true })
  await mkdir(pngOutputDir, { recursive: true })

  const sourceMetadata = await sharp(sourcePngPath).metadata()

  if (sourceMetadata.format !== 'png') {
    throw new Error(`Source icon must be PNG: ${sourcePngPath}`)
  }

  const masterPng = await renderSquarePng(sourcePngPath, 1024)
  const rootPngPath = path.join(outputDir, 'icon.png')
  const icoPath = path.join(outputDir, 'icon.ico')
  const icnsPath = path.join(outputDir, 'icon.icns')

  await writePngVariants(masterPng)
  await writeFile(rootPngPath, masterPng)

  const icoBuffer = assertBuffer(
    png2icons.createICO(masterPng, png2icons.BILINEAR, 0, true, true),
    icoPath,
  )
  await writeFile(icoPath, icoBuffer)

  const icnsBuffer = assertBuffer(
    png2icons.createICNS(masterPng, png2icons.BILINEAR, 0),
    icnsPath,
  )
  await writeFile(icnsPath, icnsBuffer)

  console.log(`Generated icon assets in ${path.relative(projectRoot, outputDir)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
