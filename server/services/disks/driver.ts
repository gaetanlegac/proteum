/*----------------------------------
- DEPS
----------------------------------*/

// Core
import type { Application } from '@server/app';
import Service from '@server/app/service';

/*----------------------------------
- CONFIG
----------------------------------*/

export type THooks = {

}

export type Services = {

}

/*----------------------------------
- TYPE
----------------------------------*/

export type TDrivercnfig = {

    debug: boolean,

    rootDir: string,
    buckets: {
        [id: string]: string
    }
}

export type SourceFile = { 
    name: string, 
    path: string, 
    modified: number, 
    parentFolder: string,
    source: string 
}

export type TOutputFileOptions = {
    encoding: string
}

export type TReadFileOptions = {
    encoding?: 'string'|'buffer',
    withMetas?: boolean
}

/*----------------------------------
- CLASS
----------------------------------*/

export default abstract class FsDriver<
    Config extends TDrivercnfig = TDrivercnfig,
    TBucketName = keyof Config["buckets"]
> extends Service<Config, {}, Application, Application> {

    public constructor( config: Config, app: Application ) {
        super(app, config, app);
    }

    public abstract mount(): Promise<void>;

    public abstract getFileUrl(
        bucketName: TBucketName, 
        filename: string
    ): string;
    
    public abstract readDir( bucketName: TBucketName, dirname?: string ): Promise<SourceFile[]>;

    public abstract readFile( 
        bucketName: TBucketName, 
        filename: string, 
        options: TReadFileOptions
    ): Promise<Buffer>;

    public abstract createReadStream( bucketName: TBucketName, filename: string );

    public abstract exists( bucketName: TBucketName, filename: string ): Promise<boolean>;

    public abstract move( bucketName: TBucketName, source: string, destination: string, options: { overwrite?: boolean }): Promise<void>;

    public abstract outputFile( 
        bucketName: TBucketName, 
        filename: string, 
        content: string | Buffer, 
        options?: TOutputFileOptions 
    ): Promise<{
        path: string
    }>;

    public abstract readJSON( bucketName: TBucketName, filename: string ): Promise<any>;

    public abstract delete( bucketName: TBucketName, filename: string ): Promise<boolean>;

    public abstract deleteDir( bucketName: TBucketName, dirname: string ): Promise<boolean>;

    public abstract unmount(): Promise<void>;

}