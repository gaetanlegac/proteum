/*----------------------------------
- DEPENDANCES
----------------------------------*/

// Npm
import loadScript from 'load-script';

/*----------------------------------
- SERVICE
----------------------------------*/
export default class Recaptcha {

    private idClientCaptcha: string | null = null;
    public init(): Promise<void> {
        const idConteneurBadge = 'badge-recaptcha';
        return new Promise((resolve: Function, reject: Function) => {

            // Déjà chargé
            if (this.idClientCaptcha !== null)
                return resolve();

            loadScript('https://www.google.com/recaptcha/api.js?render=explicit', (err/*, script*/) => {
                
                if (err) {
                    reject(err);
                    return;
                }

                grecaptcha.ready(() => {

                    const conteneur = document.getElementById(idConteneurBadge);

                    if (!conteneur)
                        throw new Error("Conteneur badge recaptcha pas trouvé");

                    if (this.idClientCaptcha === null) {
                        if (conteneur.dataset.flottant)
                            this.idClientCaptcha = grecaptcha.render(idConteneurBadge, {
                                'sitekey': this.app.apis.recaptcha.pub,
                                'size': 'invisible'
                            });
                        else
                            this.idClientCaptcha = grecaptcha.render(idConteneurBadge, {
                                'sitekey': this.app.apis.recaptcha.pub,
                                'badge': 'inline',
                                'size': 'invisible'
                            });
                    }

                    if (this.idClientCaptcha !== null)
                        resolve();
                    else
                        reject("Attendez que la page soit complètement chargée. Si c'est déjà le cas, rechargez la page.");
                });
            })
        });
    }

    public async check(action: string): Promise<string> {

        await this.init();

        const token = grecaptcha.execute(this.idClientCaptcha, { action: action });

        return token;
    }
}