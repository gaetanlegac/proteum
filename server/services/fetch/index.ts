/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import type { default as sharp, Sharp } from 'sharp';
import fs from 'fs-extra';
import got, { Method, Options } from 'got';

// Node
import request from 'request';

// Core: general
import type { Application } from '@server/app';
import Service, { AnyService } from '@server/app/service';
import { viaHttpCode } from '@common/errors';

// Local
import type { TAnyRouter } from '../router';
import type DisksManager from '../disks';
import type FsDriver from '../disks/driver';

/*----------------------------------
- SERVICE TYPES
----------------------------------*/

export type Config = {
    debug?: boolean,
    disk?: string,

    disks: DisksManager,
    router?: TAnyRouter
}

export type Hooks = {

}

/*----------------------------------
- TYPES
----------------------------------*/

export type TImageConfig = {
    sharp: typeof sharp,
    width: number,
    height: number,
    fit: keyof sharp.FitEnum,
    quality: number
}

/*----------------------------------
- CONST
----------------------------------*/

const LogPrefix = `[services][fetch]`

/*----------------------------------
- SERVICE
-  Tools that helps to consume external resources (including apis, ..)
-----------------------------------*/
export default class FetchService extends Service<Config, Hooks, Application, Application> {

    private disk?: FsDriver;

    public async ready() {

        if (this.config.disks)
            this.disk = this.config.disks.get( this.config.disk );

    }

    public async shutdown() {

    }

    /*----------------------------------
    - EXTERNAL API REQUESTS
    ----------------------------------*/

    public post( 
        url: string, 
        data: {[k: string]: any}, 
        options: {} = {} 
    ) {

        return this.request('POST', url, data, options);

    }

    public async request( 
        method: Method,
        url: string, 
        data: {[k: string]: any}, 
        options: Options = {} 
    ) {

        // Parse url if router service is provided
        if (this.config.router === undefined)
            throw new Error(`Please bind the Router service to the Fetch service in order to contact APIs.`);

        url = this.config.router.url(url);

        // Send request
        const res = await got(url, {
            throwHttpErrors: false,
            headers: {
                'Accept': 'application/json',
            },
            method,
            ...(method === 'GET' ? {
                searchParams: data
            } : {
                json: data
            })
        })

        // Handle errors
        if (res.statusCode !== 200) {

            // Instanciate error from HTTP code
            const error = viaHttpCode( res.statusCode, res.body );
            if (error)
                throw error;

            // Not catched via viaHttpCode
            console.log("RESPONSE", res.body);
            throw new Error("Error while contacting the API");
        }

        // Format & return response
        return JSON.parse( res.body );
    }

    /*----------------------------------
    - IMAGES
    ----------------------------------*/

    public toBuffer( uri: string ): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            request(uri, { encoding: null }, (err, res, body) => {

                if (err)
                    return reject(err);

                if (!body)
                    return reject(`Body is empty for ${uri}.`);

                resolve(body);
            })
        })
    }

    public async image( 
        imageFileUrl: string, 
        imageMod: TImageConfig, 
        saveToBucket: string,
        saveToPath?: string,
        disk?: string
    ): Promise<Buffer | null> {

        // Define target disk
        if (this.disk === undefined)
            throw new Error(`Please provide a Disks service in order to download files.`);

        // Download
        let imageBuffer: Buffer | null;
        try {
            imageBuffer = await this.toBuffer( imageFileUrl );
        } catch (error) {
            console.error(LogPrefix, `Error while fetching image at ${imageFileUrl}:`, error);
            return null;
        }

        if (imageMod) {

            const { sharp, width, height, fit, quality } = imageMod;

            // Resize
            const processing = sharp( imageBuffer )
                // Max dimensions (save space)
                .resize(width, height, { fit }) 
    
            // Convert to webp and finalize
            imageBuffer = await processing.webp({ quality }).toBuffer().catch(e => {
                console.error(LogPrefix, `Error while processing image at ${imageFileUrl}:`, e);
                return null;
            })

        }

        // Save file
        if (saveToPath !== undefined && imageBuffer !== null) {
            console.log(LogPrefix, `Saving ${imageFileUrl} logo to ${saveToPath}`);
            await this.disk.outputFile(saveToBucket, saveToPath, imageBuffer);
        }

        // We return the original, because Vibrant.js doesn't support webp
        return imageBuffer;
    }

}