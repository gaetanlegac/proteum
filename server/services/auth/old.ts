
import md5 from 'md5';
import { OAuth2Client, LoginTicket } from 'google-auth-library';



type AuthResponse = {
    token: string,
    redirect: string,   
    user: User
}

export default class {


    protected async ready() {

        // Google auth client
        if (this.config.google) {

            const httpConfig = this.app.http.publicUrl;

            this.googleClient = new OAuth2Client(
                this.config.google.web.clientId, // Google Client ID
                this.config.google.web.secret, // Private key
                httpConfig + "/auth/google/response" // Redirect url
            );
        }
    }

    
    private googleClient: OAuth2Client | undefined;

    public async FromGoogle(request: ServerRequest): Promise<string> {

        if (!this.googleClient)
            throw new Forbidden(`Authentication method disabled.`);

        // Register  start time, so we can determine the signup time to display
        request.response?.cookie('signupstart', Date.now());

        // Google auth doesn't support local env
        // So we simulate that  google sent a response with the user email
        if (app.env.name === 'local') {
            const { redirect } =  await this.Auth("tbsoftwares23@gmail.com", request, true);
            return redirect;
        }

        return this.googleClient.generateAuthUrl({
            access_type: 'offline',
            scope: [
                "email", "profile"
            ]
        });

    }

    public async GoogleResponse(
        type: 'code' | 'token',
        codeOrToken: string | undefined,
        request: ServerRequest,
    ): Promise<AuthResponse> {

        const googleConfig = this.config.google;
        if (!this.googleClient || !googleConfig)
            throw new Forbidden(`Authentication method disabled.`);

        if (codeOrToken === undefined)
            throw new Forbidden("Bad code / token");

        if (type === 'code') {
            const r = await this.googleClient.getToken(codeOrToken);
            return this.GoogleResponse('token', r.tokens.id_token, request);
        }

        this.config.debug && console.log(LogPrefix, "Auth via google", googleConfig);

        let ticket: LoginTicket;
        try {
            ticket = await this.googleClient.verifyIdToken({
                idToken: codeOrToken,
                audience: [
                    googleConfig.web.clientId,
                    googleConfig.android.clientId,
                ]
            });
        } catch (error) {
            throw new Forbidden(`Google denied your login attempt: ` + error.message + `. If you don't think it's normal, please contact us.`);
        }

        const payload = ticket.getPayload();
        if (payload === undefined)
            throw new Forbidden("Invalid payload");
        const { email, sub: google_id } = payload;

        if (email === undefined)
            throw new Forbidden("Unable to get your email address from the Google sign-in.");

        return await this.Auth(email, request, true);

    }

    /**
     * Login u
     * @param email Email that identifies the account to log in
     * @param request Used to call security-related features
     * @param canPass true when from 3rd party auth, we're sure the email is owned bu the current user
     * @param userInfo User field to update (eg: lastLogin)
     * @returns 
     */
    public async Auth( 
        email: string, 
        request: ServerRequest, 
        canPass: boolean = false,
        userInfo: Partial<User> = {} 
    ): Promise<AuthResponse> {

        let user = await this.getData('email = ' + this.sql.esc(email));
        let ip: IP;
        let redirect: string;
        if (!user) { // Signup

            ip = await request.detect.botsAndMultiaccount();

            // Create user
            ({ user, redirect } = await this.Signup(email, request));

        } else if (!canPass) { // Send login email

            throw new Forbidden("This option is not available");

            // If the current IP was used to connect to another account that the current
            ip = await request.detect.botsAndMultiaccount(user.email);

            // Send email with link to /auth/token (expiration 5 min)

            // Route /auth/:token: check si même ip, même device

        } else { // Login 

            redirect = config.logoutUrl;
            
        }

        /*await this.sql`
            INSERT INTO UserLogin SET
                user = ${user.email},
                date = NOW(),
                ip = ${request.ip},
                device = ${request.deviceString()}
        `.run();*/

        const token = request.auth.login(user.email);

        return { token, user, redirect };

    }

    public async Signup(email: string, request: ServerRequest, moreInfos: Partial<User> = {}) {

        let username = email.split('@')[0];

        // Prefix username if alreasy existing
        const duplicates = await this.sql`
            FROM User 
            WHERE name REGEXP CONCAT('^', ${username}, '[0-9]*$');
        `.count();

        if (duplicates !== 0)
            username += duplicates;

        const user: Partial<User> = {
            email,
            emailHash: md5(email),
            name: username,
            referrer: request.cookies.r,
            utm: request.cookies.utm,
            ...moreInfos
        }

        // Hook
        if (this.beforeSignup !== undefined)
            await this.beforeSignup( user );
            
        // Referrer
        if (user.referrer !== undefined) {

            const refExists = await this.sql`FROM User WHERE name = ${user.referrer}`.exists();
            if (!refExists)
                user.referrer = undefined;
            else {
                
                await this.sql.upsert('UserStats', { 
                    user: user.referrer,
                    date: new Date,
                    refSignups: 1 
                }, ['refSignups'], {
                    upsertMode: 'increment'
                });
            }
        }
            
        // Create user
        await this.sql.insert('User', user);
        await this.sql.update('logs.IP', { user_name: username }, { address: request.ip });

        // Hook
        let redirect: string = '/';
        if (this.afterSignup !== undefined)
            ({ redirect } = await this.afterSignup(user));

        // TODO: download user avatar from gravatar
        // remove user.emailHash

        // Notif email
        await this.email.send({
            to: app.identity.author.email,
            subject: app.identity.name + ": New User",
            html: JSON.stringify(user)
        });

        // TODO
        // this.hook.signup(user);
        //Achievements.activity(user, 'just signed up', null);

        // Instanciation
        return { user, redirect };

    }

    public async setReferrer( referrer: unknown, { user, response, cookies, req, detect, request }: ServerRequest) {

        if (!response || user)
            return;

        // Source tracking
        if (!cookies.utm) {

            const data = req.query;

            const utm = [data.utm_medium, data.utm_source, data.utm_campaign]
                .filter(a => a !== undefined);

            response.cookie('utm', utm.join(','));
        }

        // Referral program
        if (cookies.r === undefined && typeof referrer === "string") {

            const conflict = await detect.conflictOfInterest( referrer, request );
            if (conflict)
                return;

            // Check if user exists
            const referrerExists = await this.sql`FROM User WHERE name = ${referrer}`.count();
            if (referrerExists === 0)
                return;

            // await secutity.detectCheatAttempts();
            // => Check IP (reprendre code existant)
            // => Check si IP pas déjà utilisée par un autre membre (1 compte par IP)

            // Tracking cookie for signup
            response.cookie('r', referrer);

            // Count the clic 
            await this.sql.upsert('UserStats', { 
                user: referrer,
                date: new Date,
                refClics: 1 
            }, ['refClics'], {
                upsertMode: 'increment'
            });
        }

    }
}