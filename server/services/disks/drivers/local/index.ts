/*----------------------------------
- DEPS
----------------------------------*/
/*
    A simple adapter to use fs-extra functions with AWS S3 buckets
*/

// Node
import path from 'path';
import dayjs from 'dayjs';

// Npm
import fs from 'fs-extra';

// Core
import AppContainer from '@server/app/container';

// Specific
import DiskDriver, { TDrivercnfig, SourceFile, TOutputFileOptions } from '../../driver';

/*----------------------------------
- CONFIG
----------------------------------*/

/*----------------------------------
- TYPES
----------------------------------*/

export type TConfig = TDrivercnfig & {

}

/*----------------------------------
- SERVICE
----------------------------------*/
export default class LocalFS<
    Config extends TConfig = TConfig,
    TBucketName = keyof Config["buckets"]
> extends DiskDriver<TConfig> {

    public rootDir = AppContainer.path.var;

    public async mount() {

    }

    public async unmount() {

    }

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/

    public getFileUrl(
        bucketName: TBucketName, 
        filename: string
    ) {
        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename || '.' );
        return fullPath;
    }

    public async readDir( bucketName: TBucketName, dirname?: string ) {

        const bucketDir = this.config.buckets[bucketName];
        
        const fullPath = path.join( this.rootDir, bucketDir, dirname || '.' );

        // Combine the files list of all source directory
        const files: SourceFile[] = [];
        const sources = fs.readdirSync( fullPath, { withFileTypes: true });
        for (const source of sources) {

            if (!source.isDirectory())
                continue;

            const parentFolder = source.name;
            const csvFiles = fs.readdirSync( 
                path.join( fullPath, parentFolder ), 
                { withFileTypes: true }
            );

            for (const file of csvFiles) {

                if (!file.isFile() || !file.name.endsWith('.csv'))
                    continue;

                const relPath = path.join( source.name, file.name );
                const fullpath = path.join( fullPath, relPath );
                const stats = fs.statSync(fullpath);

                const rowsCount = fs.readFileSync( fullpath, 'utf-8').split('\n').length - 1;

                const name = dayjs(stats.mtime).format('DD/MM HH:mm:ss') 
                    + ' : ' + path.join( source.name, file.name )
                    + ' : ' + rowsCount + ' contacts'

                files.push({
                    name,
                    path: relPath,
                    parentFolder,
                    source: source.name,
                    modified: stats.mtimeMs
                });

            }
        }
        
        this.config.debug && console.log(`readDir ${fullPath}: ${files.length} objects`);
        return files;
    }

    public async readFile( bucketName: TBucketName, filename: string ) {
        
        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename );

        this.config.debug && console.log(`readFile ${fullPath}`);
        return fs.readFileSync( fullPath );
    }

    public createReadStream( bucketName: TBucketName, filename: string ) {
        
        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename );

        this.config.debug && console.log(`createReadStream ${fullPath}`);
        return fs.createReadStream( fullPath );
    }

    public async exists( bucketName: TBucketName, filename: string ) {
        
        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename );

        this.config.debug && console.log(`exists ${fullPath}`);
        return fs.existsSync( fullPath );
    }

    public async move( bucketName: TBucketName, source: string, destination: string, options: { overwrite?: boolean } = {}) {
        
        const bucketDir = this.config.buckets[bucketName];
        const fullPathSource = path.join( this.rootDir, bucketDir, source );
        const fullPathDestination = path.join( this.rootDir, bucketDir, destination );

        this.config.debug && console.log(`move ${fullPathSource} to ${fullPathDestination}`);
        return fs.moveSync(fullPathSource, fullPathDestination, options);
    }

    public async outputFile( 
        bucketName: TBucketName, 
        filename: string, 
        content: string | Buffer, 
        options?: TOutputFileOptions 
    ) {

        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename );
        this.config.debug && console.log(`outputFile`, fullPath);

        fs.outputFileSync( fullPath, content, options );

        return {
            path: fullPath
        }
    }

    public async readJSON( bucketName: TBucketName, filename: string ) {
        
        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename );

        this.config.debug && console.log(`readJSON ${fullPath}`);
        return fs.readJsonSync( fullPath );
    }

    public async delete( bucketName: TBucketName, filename: string ) {
        
        const bucketDir = this.config.buckets[bucketName];
        const fullPath = path.join( this.rootDir, bucketDir, filename );

        this.config.debug && console.log(`delete ${fullPath}`);
        fs.removeSync( fullPath );
        return true;
    }

}