// Folders arrive two ways: dropped, as entries of the DataTransfer, or picked with an input that has
// webkitdirectory, which sets webkitRelativePath. Both end as plain files that remember their folder.
const folders = new WeakMap<File, string>();

// What a folder carries along without anyone choosing it
const SYSTEM = /^(\..*|desktop\.ini|thumbs\.db|icon\r?|__macosx)$/i;
const isSystem = (path: string) => path.split('/').some((part) => SYSTEM.test(part));
const parent = (path: string) => path.split('/').filter(Boolean).slice(0, -1).join('/');

/** The folder a file sat in, relative to what was dropped or picked; '' for a loose file */
const folderOf = (file: File) => folders.get(file) ?? parent(file.webkitRelativePath);

/** The folder that was dropped or picked, '' if only loose files came */
export const topFolder = (files: File[]) => files.map(folderOf).find(Boolean)?.split('/')[0] ?? '';

const pickedFiles = (list: FileList | null) => Array.from(list ?? []).filter((f) => !isSystem(f.webkitRelativePath || f.name));

/** Opens the file dialog, for files or for one folder with everything inside */
export function chooseFiles(folder: boolean, onFiles: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = folder;
  input.onchange = () => onFiles(pickedFiles(input.files));
  input.click();
}

/** Files of a drop, with everything inside dropped folders; only the loose ones if a folder cannot be read.
 * Call it in the drop event itself: the browser empties the DataTransfer afterwards. */
export function droppedFiles(data: DataTransfer | null): Promise<File[]> {
  if (!data) return Promise.resolve([]);
  const loose = Array.from(data.files);
  const entries = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry());
  if (!entries.some((entry) => entry?.isDirectory)) return Promise.resolve(loose);
  return Promise.all(entries.map((entry) => (entry ? read(entry) : [])))
    .then((lists) => lists.flat())
    .catch(() => loose.filter((f) => f.type || f.size));
}

async function read(entry: FileSystemEntry): Promise<File[]> {
  if (isSystem(entry.name)) return [];
  if (isFile(entry)) {
    const file = await new Promise<File>((done, fail) => entry.file(done, fail));
    folders.set(file, parent(entry.fullPath));
    return [file];
  }
  if (!isDirectory(entry)) return [];
  const reader = entry.createReader();
  const children: FileSystemEntry[] = [];
  // readEntries hands out a batch per call, an empty one at the end
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(read))).flat();
}

const isFile = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;
const isDirectory = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory;

// Folders inside a song that say nothing about it
const GENERIC = /^(stems?|spuren|multitracks?|track ?outs?|audio( files)?|bounces?|bounced files|exports?|renders?|mix(es|downs?)?)$/i;

/** The song a group of files is named after: the deepest folder they share, without "Stems" and the like. "Kreise/Stems" and "Kreise Stems" → "Kreise" */
export function songFolder(files: File[]) {
  let parts = folderOf(files[0]).split('/').filter(Boolean);
  for (const file of files.slice(1)) {
    const other = folderOf(file).split('/');
    let i = 0;
    while (i < parts.length && parts[i] === other[i]) i++;
    parts = parts.slice(0, i);
  }
  while (parts.length && GENERIC.test(parts.at(-1)!)) parts = parts.slice(0, -1);
  return (parts.at(-1) ?? '').replace(/[\s_\-–—]+(stems?|spuren|multitracks?)$/i, '').trim();
}
