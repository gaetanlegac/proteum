import path from 'path';
import fs from 'fs-extra';

const toBuffer = (content: string | Buffer) => (typeof content === 'string' ? Buffer.from(content) : content);

export default function writeIfChanged(filepath: string, content: string | Buffer) {
    const nextContent = toBuffer(content);
    const dirpath = path.dirname(filepath);

    fs.ensureDirSync(dirpath);

    if (fs.existsSync(filepath)) {
        const currentContent = fs.readFileSync(filepath);

        if (currentContent.equals(nextContent)) return false;
    }

    fs.writeFileSync(filepath, nextContent);

    return true;
}
