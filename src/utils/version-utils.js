class VersionUtils {
    static parseVersion(versionString) {
        if (!versionString || typeof versionString !== 'string') {
            throw new Error('Invalid version string');
        }
        
        const parts = versionString.trim().split('.');
        if (parts.length < 2 || parts.length > 3) {
            throw new Error('Version must be in format x.y or x.y.z');
        }
        
        const major = parseInt(parts[0], 10);
        const minor = parseInt(parts[1], 10);
        const patch = parts.length === 3 ? parseInt(parts[2], 10) : 0;
        
        if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
            throw new Error('Version parts must be numbers');
        }
        
        return { major, minor, patch };
    }
    
    static compareVersions(version1, version2) {
        const v1 = this.parseVersion(version1);
        const v2 = this.parseVersion(version2);
        
        if (v1.major !== v2.major) {
            return v1.major - v2.major;
        }
        
        if (v1.minor !== v2.minor) {
            return v1.minor - v2.minor;
        }
        
        return v1.patch - v2.patch;
    }
    
    static isCompatible(proxyVersion, requiredVersion, type) {
        try {
            const comparison = this.compareVersions(proxyVersion, requiredVersion);
            
            switch (type) {
                case 'min':
                    return comparison >= 0;
                case 'max':
                    return comparison <= 0;
                case 'exact':
                    return comparison === 0;
                default:
                    throw new Error(`Unknown compatibility type: ${type}`);
            }
        } catch (error) {
            console.error(`Version compatibility check failed: ${error.message}`);
            return false;
        }
    }
    
    static isVersionValid(versionString) {
        try {
            this.parseVersion(versionString);
            return true;
        } catch (error) {
            return false;
        }
    }
    
    static getVersionString(major, minor, patch = 0) {
        if (patch === 0) {
            return `${major}.${minor}`;
        }
        return `${major}.${minor}.${patch}`;
    }
}

module.exports = { VersionUtils };