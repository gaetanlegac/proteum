/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Core
import type { Application } from '@server/app';
import Service from '@server/app/service';
import markdown from '@common/data/markdown';

// Speciic
import { jsonToHtml } from './utils';

/*----------------------------------
- SERVICE CONFIG
----------------------------------*/

const LogPrefix = `[services][email]`

export type Config = {
    debug: boolean,
    simulateWhenLocal: boolean,
    default: {
        from: TPerson
    },
    bugReport: {
        from: TPerson,
        to: TPerson
    },
}

export type Hooks = {

}

export type Services = {

}

/*----------------------------------
- TYPES: EMAILS
----------------------------------*/

export type TEmail = THtmlEmail | TMarkdownEmail;

type TPerson = {
    name?: string,
    email: string
}

type TBaseEmail = { 
    to: TPerson | TPerson[], 
    cc?: TPerson | TPerson[]
    from?: TPerson,
};

export type THtmlEmail = TBaseEmail & {
    subject: string,
    html: string | { [label: string]: any },
}

export type TMarkdownEmail = TBaseEmail & {
    subject: string,
    markdown: string,
}

export type TCompleteEmail = With<THtmlEmail, {
    to: TPerson[],
    from: TPerson,
    cc: TPerson[]
}>;

type TShortEmailSendArgs =  [
    to: string, 
    subject: string, 
    markdown: string, 
    options?: TOptions
]

type TCompleteEmailSendArgs = [
    emails: TEmail | TEmail[], 
    options?: TOptions
]

type TEmailSendArgs = TShortEmailSendArgs | TCompleteEmailSendArgs;

/*----------------------------------
- TYPES: OPTIONS
----------------------------------*/
type TOptions = {
    transporter?: string
}

/*----------------------------------
- FONCTIONS
----------------------------------*/
export default abstract class Email<TConfig extends Config> 
    extends Service<TConfig, Hooks, Application, Application> {

    /*----------------------------------
    - ACTIONS
    ----------------------------------*/

    protected abstract sendNow( emails: TCompleteEmail[] ): Promise<void>;

    public async send( to: string, subject: string, markdown: string, options?: TOptions );
    public async send( emails: TEmail | TEmail[], options?: TOptions ): Promise<void>;
    public async send( ...args: TEmailSendArgs ): Promise<void> {

        let emails: TEmail[] | TEmail;
        let options: TOptions | undefined;
        if (typeof args[0] === 'string') {
            const [to, subject, markdown, opts] = args as TShortEmailSendArgs;
            emails = [{
                to: { email: to },
                subject,
                markdown
            }]
            options = opts;
        } else {

            ([ emails, options ] = args as TCompleteEmailSendArgs);
            if (!Array.isArray( emails ))
                emails = [emails];
            else if (emails.length === 0)
                return console.warn(LogPrefix, `No email to send.`);
        }

        options = options || {}

        this.config.debug && console.log(`Preparing to send ${emails.length} emails ...`);

        const htmlWarning = this.app.env.profile === 'dev'
            ? `⚠️ This email has been sent for testing purposes. Please ignore it if you're not a developer.<br /><br />`
            : '';

        const emailsToSend: TCompleteEmail[] = emails.map(email => {

            const from: TPerson = email.from === undefined
                ? this.config.default.from
                : email.from;

            const cc: TPerson[] = email.cc === undefined ? [] : Array.isArray(email.cc)
                ? email.cc
                : [email.cc];

            const to: TPerson[] = Array.isArray(email.to)
                ? email.to
                : [email.to];

            if ('markdown' in email) {

                return {
                    ...email,
                    html: htmlWarning + markdown.render(email.markdown),
                    from,
                    to,
                    cc
                }

            } else {
                return {
                    ...email,
                    html: htmlWarning + (typeof email.html === "string" 
                        ? email.html 
                        : jsonToHtml(email.html)),
                    from,
                    to,
                    cc
                }
            }
            
        });

        console.info(LogPrefix, `Sending ${emailsToSend.length} emails:`, emailsToSend[0].subject);

        // Pas d'envoi d'email quand local
        if (this.app.env.profile !== 'prod' && this.config.simulateWhenLocal === true) {
            console.log(LogPrefix, `Simulate email sending:\n`, emailsToSend[0].html);
            return;
        } else if (emailsToSend.length === 0) {
            console.warn(LogPrefix, `No email to send.`);
            return;
        }

        await this.sendNow(emailsToSend);

    }
}