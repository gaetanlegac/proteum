/*----------------------------------
- DEPS
----------------------------------*/
/*
    A simple adapter to use fs-extra functions with AWS S3 buckets
*/

// Node
import path from 'path';

// Npm
import AWS from 'aws-sdk';
import dayjs from 'dayjs';

// Core
import type { Application } from '@server/app';
import type { TServiceArgs } from '@server/app/service';

// Specific
import DiskDriver, { 
    TDrivercnfig, 
    SourceFile, 
    TOutputFileOptions,
    TReadFileOptions 
} from '@server/services/disks/driver';

/*----------------------------------
- CONFIG
----------------------------------*/

const debug = false;

/*----------------------------------
- TYPES
----------------------------------*/

export type TConfig = TDrivercnfig & {
    accessKeyId: string, 
    secretAccessKey: string, 
    region: string,
}

/*----------------------------------
- SERVICE
----------------------------------*/
export default class S3Driver<
    Config extends TConfig = TConfig,
    TBucketName = keyof Config["buckets"]
> extends DiskDriver<TConfig> {

    public s3: AWS.S3; 

    public constructor( config: TConfig, app: Application ) {

        super(config, app);

        AWS.config.update({
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
        });

        this.s3 = new AWS.S3(); 
    }

	/*----------------------------------
    - DISK LIFECYCLE
    ----------------------------------*/

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

        const bucket = this.config.buckets[bucketName];
        if (bucket === undefined)
            throw new Error(`Bucket "${bucketName}" not found in configuration`);
        return `https://${bucket}.s3.${this.config.region}.amazonaws.com/${filename}`
    }

    public readDir( bucketName: TBucketName, dirname?: string ) {
        const bucket = this.config.buckets[bucketName];
        return new Promise<SourceFile[]>((resolve, reject) => {
           debug && console.log(`readDir ` + (dirname === undefined ? bucket : path.join( bucket, dirname )));
            this.s3.listObjectsV2({ Bucket: bucket }, async (err, data) => {

                if (err) return reject(err);

                const files: SourceFile[] = [];
                for (const file of data.Contents) {
                    
                    const [source, ...hierarchy] = file.Key.split('/');
                    if (hierarchy.length > 1) // Take only direct childs
                        continue;

                    const filename = hierarchy.join('/');
                    if (!filename.endsWith('.csv'))
                        continue;

                    debug && console.log('-', file.Key);

                    const fileContent = await this.readFile( bucketName, file.Key );
                    const rowsCount = (fileContent as unknown as string).split('\n').length - 1;

                    const name = dayjs(file.LastModified).format('DD/MM HH:mm:ss') 
                        + ' : ' + path.join( source, filename )
                        + ' : ' + rowsCount + ' contacts'

                    files.push({
                        name,
                        path: file.Key,
                        source: source,
                        modified: file.LastModified,
                        parentFolder: source
                    });

                }
                
                debug && console.log(`readDir ${bucket}/${dirname || ''}: ${files.length} objects`);
                resolve(files);
            });
        });
    }

    public readFile( 
        bucketName: TBucketName, 
        filename: string,
        options: TReadFileOptions = {}
    ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`readFile ${bucket}/${filename}`);
        return new Promise<string>(( resolve, reject ) => {
            this.s3.getObject({ 
                Bucket: bucket,  
                Key: filename
            }, (err, data) => {

                if (err) return reject(err);

                let body: any;
                switch (options.encoding) {
                    case 'string':
                        body = data.Body?.toString()
                        break;
                    default:
                        body = data.Body;
                        break;
                }

                resolve( body );
            });
        })
    }

    public createReadStream( bucketName: TBucketName, filename: string ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`createReadStream ${bucket}/${filename}`);
        return this.s3.getObject({ 
            Bucket: bucket,  
            Key: filename
        }).createReadStream();
    }

    public exists( bucketName: TBucketName, filename: string ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`exists`, path.join(bucket, filename));
        return new Promise<boolean>(( resolve, reject ) => {
            this.s3.headObject({ 
                Bucket: bucket,  
                Key: filename
            }, (err, metadata) => {

                if (!err)
                    resolve(true); 
                else if (err.name === 'NotFound')
                    resolve(false);
                else
                    reject(err);
            });
        })
    }

    public async move( bucketName: TBucketName, source: string, destination: string, options: { overwrite?: boolean } = {}) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`move ${bucket}/${source} to ${bucket}/${destination}`);

        if (options.overwrite)
            await this.s3.deleteObject({
                Bucket: bucket,
                Key: destination,
            }).promise();
            
        await this.s3.copyObject({
            Bucket: bucket,  
            CopySource: source,
            Key: destination
        }).promise();

        debug && console.log(`Move ${bucket}/${source} to ${bucket}/${destination}: OK`);

    }

    public outputFile( 
        bucketName: TBucketName, 
        filename: string, 
        content: string | Buffer, 
        options?: TOutputFileOptions 
    ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`outputFile ${bucket}/${filename}`);
        return new Promise(( resolve, reject ) => {
            this.s3.upload({
                Bucket: bucket,
                Key: filename,
                Body: content,
            }, (err, data) => {

                if (err) return reject(err);
                debug && console.log(`outputFile ${bucket}/${filename}: OK (${data.Location})`);

                resolve({
                    path: data.Location
                });
            });
        })
    }

    public async readJSON( bucketName: TBucketName, filename: string ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`readJSON ${bucket}/${filename}`);
        const filecontent = await this.readFile(bucketName, filename);
        try {
            debug && console.log(`readJSON: ${bucket}/${filename} : PARSE JSON`);
            return JSON.parse(filecontent);
        } catch (error) {
            console.error(`Failed to parse file "${filename}" as JSON: `, error);
            throw new Error(`Failed to parse file "${filename}" as JSON: ` + error);
        }
    }

    public delete( bucketName: TBucketName, filename: string ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`delete ${bucket}/${filename}`);
        return new Promise<boolean>(( resolve, reject ) => {
            this.s3.deleteObject({ 
                Bucket: bucket,  
                Key: filename
            }, (err, metadata) => {

                if (!err)
                    resolve(true); 
                else if (err.name === 'NotFound')
                    resolve(false);
                else
                    reject(err);
            });
        })
    }

    public async deleteDir( bucketName: TBucketName, directoryPath: string ) {
        const bucket = this.config.buckets[bucketName];
        debug && console.log(`delete ${bucket}/${directoryPath}`);
        try {
            // Liste des objets dans le répertoire
            const listedObjects = await this.s3.listObjectsV2({
                Bucket: bucket,
                Prefix: directoryPath
            }).promise();

            if (!listedObjects.Contents?.length) return;

            // Supprimer les objets
            await this.s3.deleteObjects({
                Bucket: bucket,
                Delete: {
                    Objects: listedObjects.Contents.map(({ Key }) => ({ Key }))
                }
            }).promise();

            // Récursivement, traiter d'autres pages d'objets si elles existent
            //if (listedObjects.IsTruncated) await deleteDirectory();

            console.log(`Le répertoire ${directoryPath} a été supprimé.`);
            
        } catch (error) {
            console.error("Erreur lors de la suppression :", error);
        }
    }

}