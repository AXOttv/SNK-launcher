/**
 * SNK : Last Dawn — authentification Microsoft
 *
 * Même chaîne que la bibliothèque (Microsoft -> Xbox Live -> XSTS -> Minecraft),
 * mais SANS l'appel "entitlements/mcstore", qui renvoie de faux négatifs
 * ("You don't own the game") pour certains comptes (Game Pass, etc.).
 * La possession du jeu est vérifiée via le profil Minecraft : s'il existe, le compte a le jeu.
 */
const { Microsoft } = require('minecraft-java-core-azbetter');
const crypto = require('crypto');

class SnkMicrosoft extends Microsoft {
    async getAccount(oauth2) {
        // 1. Xbox Live
        const xbl = await this.fetchJSON('https://user.auth.xboxlive.com/user/authenticate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                Properties: {
                    AuthMethod: 'RPS',
                    SiteName: 'user.auth.xboxlive.com',
                    RpsTicket: `d=${oauth2.access_token}`
                },
                RelyingParty: 'http://auth.xboxlive.com',
                TokenType: 'JWT'
            })
        });
        if (xbl.error || !xbl.Token) return { error: xbl.error || 'xbl', errorType: 'xbl', ...xbl };

        // 2. XSTS pour les services Minecraft
        const xsts = await this.fetchJSON('https://xsts.auth.xboxlive.com/xsts/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
                RelyingParty: 'rp://api.minecraftservices.com/',
                TokenType: 'JWT'
            })
        });
        if (xsts.error || xsts.XErr || !xsts.Token) {
            return { error: xsts.error || 'xsts', errorType: 'xsts', XErr: xsts.XErr };
        }

        // 3. XSTS Xbox Live (xuid / gamertag) — informatif, ne bloque pas la connexion
        const xboxAccount = await this.fetchJSON('https://xsts.auth.xboxlive.com/xsts/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
                RelyingParty: 'http://xboxlive.com',
                TokenType: 'JWT'
            })
        });
        const xui = xboxAccount?.DisplayClaims?.xui?.[0] || {};

        // 4. Token Minecraft
        const mcLogin = await this.fetchJSON('https://api.minecraftservices.com/authentication/login_with_xbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identityToken: `XBL3.0 x=${xbl.DisplayClaims.xui[0].uhs};${xsts.Token}`
            })
        });
        if (mcLogin.error || !mcLogin.access_token) {
            return { error: mcLogin.error || 'mcLogin', errorType: 'mcLogin', ...mcLogin };
        }

        // 5. Profil Minecraft : s'il n'existe pas, le compte ne possède pas Minecraft Java
        const profile = await this.getProfile(mcLogin);
        if (profile.error) {
            return { error: profile.error, errorType: 'game' };
        }

        return {
            access_token: mcLogin.access_token,
            client_token: crypto.randomBytes(16).toString('hex'),
            uuid: profile.id,
            name: profile.name,
            refresh_token: oauth2.refresh_token,
            user_properties: '{}',
            meta: {
                type: 'Xbox',
                access_token_expires_in: mcLogin.expires_in + Math.floor(Date.now() / 1000),
                demo: false
            },
            xboxAccount: {
                xuid: xui.xid,
                gamertag: xui.gtg,
                ageGroup: xui.agg
            },
            profile: {
                skins: profile.skins,
                capes: profile.capes
            }
        };
    }
}

module.exports = SnkMicrosoft;
