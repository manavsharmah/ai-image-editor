// Checks that a chosen file is a photo the editor supports.
// Looks at the first bytes, because file names and types can be wrong.

const SIGNATURES = [
  /^\xff\xd8\xff/, // JPG
  /^\x89PNG\r\n\x1a\n/, // PNG
  /^RIFF[^]{4}WEBP/, // WebP
];
const HEIC = /^[^]{4}ftyp(hei|hev|mif1|msf1)/;

// Returns a message for the user, or '' if the file is fine.
export async function checkPhoto(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const start = String.fromCharCode(...bytes);
  if (SIGNATURES.some((signature) => signature.test(start))) return '';
  if (HEIC.test(start) || /\.hei[cf]$/i.test(file.name)) {
    return 'HEIC photos are not supported yet. Please convert it to JPG and try again.';
  }
  return 'That file is not supported. Please choose a JPG, PNG or WebP photo.';
}
