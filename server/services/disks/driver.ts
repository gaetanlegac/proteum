/*----------------------------------
- DEPS
----------------------------------*/

// Core
import type { Application } from '@server/app/index';
import Service, { TSetupConfig } from '@server/app/service';

/*----------------------------------
- CONFIG
----------------------------------*/

export type THooks = {};

export type Services = {};

/*----------------------------------
- TYPE
----------------------------------*/

export type TDrivercnfig = {
    debug: boolean;

    rootDir: string;
    buckets: { [id: string]: string };
};

export type SourceFile = { name: string; path: string; modified: number; parentFolder: string; source: string };

export type TOutputFileOptions = { encoding: BufferEncoding };

export type TReadFileOptions = { encoding?: 'string' | 'buffer'; withMetas?: boolean };

type TBucketNameFromConfig<TConfig extends TDrivercnfig> = Extract<keyof TConfig['buckets'], string>;

/*----------------------------------
- CLASS
----------------------------------*/

export default abstract class FsDriver<
    Config extends TDrivercnfig = TDrivercnfig,
    TBucketName extends TBucketNameFromConfig<Config> = TBucketNameFromConfig<Config>,
> extends Service<Config, {}, Application, Application> {
    public constructor(config: TSetupConfig<Config>, app: Application) {
        super(app, config, app);
    }

    public abstract mount(): Promise<void>;

    public abstract getFileUrl(bucketName: TBucketName, filename: string): string;

    public abstract readDir(bucketName: TBucketName, dirname?: string): Promise<SourceFile[]>;

    public abstract readFile(
        bucketName: TBucketName,
        filename: string,
        options?: TReadFileOptions,
    ): Promise<Buffer | string>;

    public abstract createReadStream(bucketName: TBucketName, filename: string): unknown;

    public abstract exists(bucketName: TBucketName, filename: string): Promise<boolean>;

    public abstract move(
        bucketName: TBucketName,
        source: string,
        destination: string,
        options: { overwrite?: boolean },
    ): Promise<void>;

    public abstract outputFile(
        bucketName: TBucketName,
        filename: string,
        content: string | Buffer,
        options?: TOutputFileOptions,
    ): Promise<{ path: string }>;

    public abstract readJSON(bucketName: TBucketName, filename: string): Promise<any>;

    public abstract delete(bucketName: TBucketName, filename: string): Promise<boolean>;

    public abstract deleteDir(bucketName: TBucketName, dirname: string): Promise<boolean>;

    public abstract unmount(): Promise<void>;
}
