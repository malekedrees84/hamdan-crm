const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'course_files');

function getFilePath(courseIndex) {
  const extensions = ['pdf', 'docx', 'txt'];
  for (const ext of extensions) {
    const p = path.join(DIR, `course_${courseIndex}.${ext}`);
    if (fs.existsSync(p)) return { filePath: p, ext };
  }
  return null;
}

async function readCourseInfo(courseIndex) {
  const found = getFilePath(courseIndex);
  if (!found) return null;

  const { filePath, ext } = found;

  if (ext === 'txt') {
    return fs.readFileSync(filePath, 'utf8').trim();
  }

  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text.trim();
  }

  if (ext === 'docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }

  return null;
}

function getCourseFileInfo(courseIndex) {
  const found = getFilePath(courseIndex);
  if (!found) return null;
  const stats = fs.statSync(found.filePath);
  return {
    name: path.basename(found.filePath),
    ext:  found.ext,
    size: Math.round(stats.size / 1024) + ' KB',
    uploaded: stats.mtime.toLocaleDateString('he-IL'),
  };
}

module.exports = { readCourseInfo, getCourseFileInfo };
