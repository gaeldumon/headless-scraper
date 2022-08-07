const puppeteer = require('puppeteer');

/**
 * @param {boolean} debug
 * @param {boolean} proxyMode
 */
module.exports = function PuppetManager(debug, proxyMode) {

    /***********************/
    /*       CONFIG        */
    /***********************/

    // Si debug (argument --debug) => lancement en mode headful (c'est à dire avec GUI, on voit ce qui se passe)
    this.debug = debug;

    // Si mode proxy (pas d'argument --no-proxy) => on dit à chromium de se lancer sur le proxy server localhost:3128
    // c'est à cette adresse que se bind le headless proxy de zyte (cron/screenshot/headless_proxy)
    this.proxyMode = proxyMode;

    this.browser = {};

    this.page = {};

    this.proxyConf = {
        bindIp: "127.0.0.1",
        bindPort: 3128,
        // En mode proxy on fixe par défaut l'attente max de navigation à 90 secondes (les timeouts sont en millisecondes)
        // car les navigations sont parfois plus longues et donc le timeout normal de 60s peu parfois être trop juste
        navigationTimeout: 90 * 1000
    };

    this.conf = {
        // Taille de la fenêtre pour le screenshot
        viewport: {
            width: 1920,
            height: 1080
        },
        // Attentes réseau
        // networkidle2 => attend qu'il n'y ai plus que 2 requêtes en attente sur la page actuelle (= moins long, good pour le mode proxy),
        // networkidle0 => attend qu'il n'y ai plus aucune requête en attente sur la page (on attend plus longtemps, ok pour le mode normal).
        networkIdling: (this.proxyMode) ? 'networkidle2' : 'networkidle0',
        // Arguments utilisés pour le lancement de l'instance Chromium (que réalise Puppeteer lorsqu'on fait puppeteer.launch)
        browser: {
            args: [
                "--window-size=1920,1080",
                // Le Headless Proxy lance un proxy HTTP/HTTPS sur 127.0.0.1:3128 et va proxy toutes les requêtes à
                // 64.58.126.143:8011 (proxy.zyte.com) (cf. cron/screenshot/headless_proxy/config.toml)
                (this.proxyMode === true) ? `--proxy-server=${this.proxyConf.bindIp}:${this.proxyConf.bindPort}` : ""
            ]
        }
    }


    /***********************/
    /*       HELPERS       */
    /***********************/

    /**
     * Helper qui renvoie un timestamp au format ISO.
     * @returns {string}
     */
    this.generateTimestamp = function () {
        const today = new Date();
        return today.toISOString();
    }

    /**
     * Remplace une seul occurrence de placeholder dans str par n.
     * @param {string} str
     * @param {string} placeholder
     * @param {number} n
     * @returns {string|*}
     */
    this.generateSelector = function (str, placeholder, n) {
        return str.replace(placeholder, n.toString());
    }


    /***********************/
    /*      GENERATORS     */
    /***********************/

    /**
     * Générateur d'entier impair positif, démarre à 1.
     * @returns {Generator<number, void, *>}
     */
    this.generatorPositiveOdd = function* () {
        let i = -1;
        while (true) {
            yield i += 2;
        }
    }

    /**
     * Générateur d'entier pair positif, démarre à 2.
     * @returns {Generator<number, void, *>}
     */
    this.generatorPositiveEven = function* () {
        let i = 0;
        while (true) {
            yield i += 2;
        }
    }

    /**
     * Générateur d'entier positif. Démarre à start ou 1 si start n'est pas un nombre et va de un en un.
     * @returns {Generator<number, void, *>}
     */
    this.generatorPositiveInt = function* (start = null) {
        let i = (typeof start === "number") ? start : 1;
        while (true) {
            yield i++;
        }
    }


    /***********************/
    /*      PUPPETEER      */
    /***********************/

    /**
     * Lance le navigateur Chromium. En mode headful (avec GUI - en local) si le mode debug est activé (argument --debug
     * en dernier lors de l'appel du script), autrement en mode headless.
     * @returns {Promise<void>}
     */
    this.initBrowser = async () => {
        try {
            this.browser = await puppeteer.launch({
                ignoreHTTPSErrors: true,
                headless: (!this.debug),
                args: this.conf.browser.args
            });
        } catch (err) {
            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec lancement navigateur",
                browserState: "not created",
                message: err.message
            }));
        }
    }

    /**
     * Initialise une page vide dans l'instance du navigateur lancée précédemment et configure celle ci avec les données
     * contenues dans la propriété conf de la class PuppetMaster.
     * @returns {Promise<void>}
     */
    this.initPage = async () => {
        try {
            this.page = await this.browser.newPage();

            await this.page.setViewport({
                width: this.conf.viewport.width,
                height: this.conf.viewport.height
            });

            if (this.proxyMode === true) {
                await this.page.setDefaultNavigationTimeout(this.proxyConf.navigationTimeout);

                if (this.debug === true) {
                    console.log("proxy mode enabled");
                }
            }
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec ouverture d'une nouvelle page vide ou echec de configuration",
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Navigue jusqu'à l'URL passée en paramètre. Si la réponse renvoie un code HTTP >= 400 (code d'erreur)
     * une exception est lancée et attrapée par la clause catch qui renverra un objet erreur avec entre autres
     * comme propriété le code HTTP ainsi rencontré.
     * Le waiter networkidle0 est utilisé pour être certain que la navigation est terminée c'est à dire
     * s'il n'y a pas de connexions pendant au moins 500ms.
     * @param {string} url
     * @returns {Promise<void>}
     */
    this.goto = async (url) => {
        try {
            await this.page.goto(url, {waitUntil: this.conf.networkIdling});
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec accession URL",
                pageUrl: url,
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Écrit une valeur dans un input du DOM de la page courante.
     * @param {string} selector Le sélecteur DOM de l'input ciblé.
     * @param {string} value Ce qui doit être écrit dans l'input.
     * @returns {Promise<void>}
     */
    this.write = async (selector, value) => {
        try {
            await this.page.type(selector, value, {
                delay: (this.debug) ? 100 : 0
            });
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec écriture dans le sélecteur",
                selector: selector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Clic sur un élément du DOM de la page courante et attend toute redirection lancée par le site à la suite du clic.
     * Utile notamment pour la soumission de formulaire.
     * @param {string} selector Le sélecteur DOM de l'élément cliquable ciblé.
     * @returns {Promise<void>}
     */
    this.clickAndWaitForRedirect = async (selector) => {
        try {
            await Promise.all([
                this.page.click(selector),
                this.page.waitForNavigation({waitUntil: this.conf.networkIdling})
            ]);
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec clic sur le sélecteur ou problème de redirection",
                selector: selector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Clic sur un élément du DOM de la page courante, sans attendre de redirection.
     * Utile pour les clic simples sur des éléments comme un menu, l'onglet d'un tableau etc.
     * @param {string} selector Le sélecteur DOM de l'élément cliquable ciblé.
     * @returns {Promise<void>}
     */
    this.simpleClick = async (selector) => {
        try {
            await this.page.click(selector);
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec clic sur le sélecteur",
                selector: selector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Fait un hover sur le sélecteur.
     * @param {string} selector
     * @returns {Promise<void>}
     */
    this.hovering = async (selector) => {
        try {
            await this.page.hover(selector);
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec hover sur le sélecteur",
                selector: selector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Pour le sélecteur donné (ul, li, a, div, #someid, .someclass...), cherche les attributs href qui comportent
     * la valeur cherchée (includesValue) et retourne le contenu du 1er href trouvé qui match.
     * Throw une exception si pas de href ou si aucun ne comporte la valeur cherchée.
     * @param {string} selector
     * @param {string} includesValue Valeur à chercher dans les valeurs href
     * @returns {Promise<string>} La valeur de l'attribut href du lien contenant la valeur cherchée
     */
    this.findOneLink = async (selector, includesValue) => {
        try {
            const links = await this.page.$$eval(selector, els => els.map(el => (el["href"]) ? el["href"] : false));
            const link = links.filter(el => el !== false).find(el => el.includes(includesValue));

            if (!link) {
                throw {
                    href: link
                };
            }

            return link;

        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: `Echec découverte lien incluant ${includesValue} dans le href`,
                selector: selector,
                link: err.href,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * @param {string} templateMainSelector
     * @param {string} placeholder
     * @param {GeneratorFunction} gen
     * @param {string} searchValue
     * @returns {Promise<string|*>}
     */
    this.searchUntilMatch = async (
        templateMainSelector,
        placeholder,
        gen,
        searchValue,
    ) => {
        try {
            // Instanciation du générateur choisi pour trouver le bon sélecteur qui pointe vers la destination
            let generatorMain = gen();
            // On génère le 1er sélecteur en remplaçant le placeholder donné par la prochaine valeur du générateur choisi
            let currentSelector = this.generateSelector(templateMainSelector, placeholder, generatorMain.next().value);
            // On vérifie que le sélecteur généré existe dans le DOM de la page
            await this.unkindCheckSelectorExists(currentSelector);
            // On enregistre le contenu textuel du sélecteur
            let selectorTextContent = await this.page.$eval(currentSelector, els => els.textContent);

            // Tant qu'il n'y a pas le nom du programme dans le contenu textuel du sélecteur courant on continue de chercher
            while (!selectorTextContent.toLowerCase().includes(searchValue.toLowerCase())) {
                currentSelector = this.generateSelector(templateMainSelector, placeholder, generatorMain.next().value);
                await this.unkindCheckSelectorExists(currentSelector);
                selectorTextContent = await this.page.$eval(currentSelector, els => els.textContent);
            }

            // Le bon sélecteur a été trouvé, on le renvoie
            return currentSelector;

        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: `Echec découverte sélecteur incluant ${searchValue} dans son attribut textContent`,
                selector: templateMainSelector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Prend un screenshot de la page courante à partir du point (coordonnées en paramètre), jusqu'au reste de la
     * largeur de la page et jusqu'en bas de celle ci (on se servant de la hauteur scrollable).
     * Ainsi, si startPointX = 0 et startPointY = 0 alors toute la page sera prise en screenshot.
     * @param {number} startPointX Coordonnée x (horizontale) du point de départ en pixels.
     * @param {number} startPointY Coordonnée y (verticale) du point de départ en pixels.
     * @param {string} path Chemin sous lequel le screenshot sera enregistré.
     * @returns {Promise<void>}
     */
    this.takeScreenshot = async (startPointX, startPointY, path) => {
        // On récupère la hauteur scrollable de la page (propriété scrollHeight du noeud body), pour prendre le screenshot
        // à partir du point spécifié dans le fichier de config (cf. y) jusqu'en bas de la page, la hauteur du screenshot valant:
        // hauteur totale de la page - coordonnée y du point de démarrage du screenshot
        const pageBodyScrollHeight = await this.page.$eval('body', b => b.scrollHeight);

        // On prend le screenshot de la page où on se trouve
        try {
            await this.page.screenshot({
                path: path,
                clip: {
                    x: startPointX,
                    y: startPointY,
                    width: this.conf.viewport.width,
                    height: pageBodyScrollHeight - startPointY
                }
            });
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec prise du screenshot",
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Ferme le navigateur.
     * @returns {Promise<string>}
     */
    this.closeBrowser = async () => {
        await this.browser.close();
    }

    /**
     * Renvoie le contenu de la propriété textContent du sélecteur.
     * @param {string} selector
     * @returns {Promise<string<*>>}
     */
    this.getTextContent = async (selector) => {
        try {
            return await this.page.$eval(selector, els => els.textContent);
        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Echec récupération du contenu textuel du sélecteur",
                selector: selector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }

    /**
     * Vérifie si un sélecteur existe. Ce checker est "unkind" (pas gentil) car il lance une exception si le sélecteur
     * est introuvable.
     * @param {string} selector
     * @returns {Promise<boolean>}
     */
    this.unkindCheckSelectorExists = async (selector) => {
        try {
            const search = await this.page.$(selector);

            if (search === null || search === undefined) {
                throw false;
            }

            return true;

        } catch (err) {
            await this.browser.close();

            throw new Error(JSON.stringify({
                status: "failure",
                timestamp: this.generateTimestamp(),
                info: "Sélecteur introuvable dans la page",
                selector: selector,
                pageUrl: this.page.url(),
                browserState: "closed",
                message: err.message
            }));
        }
    }
}