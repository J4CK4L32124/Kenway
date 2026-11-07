const crypto = require('crypto');
const forge = require('node-forge');

class PluginSignatureVerifier {
    constructor() {
        this.publicKey = null;
    }

    async getPublicKey() {
        try {
            const response = await fetch('https://urchin.gg/starfish/public-key');
            const data = await response.json();
            
            this.publicKey = forge.pki.publicKeyFromPem(data.publicKey);
            return this.publicKey;
        } catch (error) {
            console.error('Failed to fetch public key:', error.message);
            throw new Error('Cannot verify plugins - public key unavailable');
        }
    }

    extractSignature(fileContent) {
        const signatureRegex = /\/\*\s*KENWAY_SIGNATURE:\s*([A-Za-z0-9+/=]+)\s*\*\//;
        const match = fileContent.match(signatureRegex);
        
        if (!match) {
            return { signature: null, cleanContent: fileContent };
        }

        const signature = match[1];
        const cleanContent = fileContent.replace(signatureRegex, '').trim();
        
        return { signature, cleanContent };
    }

    calculateHash(content) {
        return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }

    async verifySignature(signature, content) {
        try {
            const publicKey = await this.getPublicKey();
            const hash = this.calculateHash(content);
            const signatureBytes = forge.util.decode64(signature);
            
            const md = forge.md.sha256.create();
            md.update(hash, 'utf8');
            
            return publicKey.verify(md.digest().bytes(), signatureBytes);
        } catch (error) {
            console.error('Signature verification error:', error.message);
            return false;
        }
    }

    async verifyPlugin(fileContent, pluginName) {
        const { signature, cleanContent } = this.extractSignature(fileContent);
        const hash = this.calculateHash(cleanContent);

        if (!signature) {
            return {
                isOfficial: false,
                verified: true,
                signature: false,
                hash,
                reason: 'No signature found - loading as normal plugin'
            };
        }

        const verified = await this.verifySignature(signature, cleanContent);

        if (verified) {
            console.log(`✓ Verified official plugin: ${pluginName}`);
            return {
                isOfficial: true,
                verified: true,
                signature: true,
                hash,
                reason: 'Valid signature - loading as official plugin'
            };
        } else {
            console.warn(`✗ Invalid signature for plugin: ${pluginName} - refusing to load`);
            return {
                isOfficial: false,
                verified: false,
                signature: true,
                hash,
                reason: 'Invalid signature - plugin blocked'
            };
        }
    }
}

module.exports = { PluginSignatureVerifier };