const { VersionUtils } = require('./version-utils');

class DependencyResolver {
    constructor() {
        this.plugins = new Map();
        this.dependencyGraph = new Map();
    }
    
    addPlugin(pluginMetadata) {
        this.plugins.set(pluginMetadata.name, pluginMetadata);
        this.dependencyGraph.set(pluginMetadata.name, {
            dependencies: this._normalizeDependencies(pluginMetadata.dependencies || []),
            optionalDependencies: this._normalizeDependencies(pluginMetadata.optionalDependencies || []),
            dependents: new Set()
        });
    }
    
    _normalizeDependencies(deps) {
        return deps.map(dep => {
            if (typeof dep === 'string') {
                return { name: dep };
            }
            return dep;
        });
    }
    
    buildDependencyGraph() {
        for (const [pluginName, node] of this.dependencyGraph) {
            node.dependencies.forEach(dep => {
                const depNode = this.dependencyGraph.get(dep.name);
                if (depNode) {
                    depNode.dependents.add(pluginName);
                }
            });
            
            node.optionalDependencies.forEach(dep => {
                const depNode = this.dependencyGraph.get(dep.name);
                if (depNode) {
                    depNode.dependents.add(pluginName);
                }
            });
        }
    }
    
    validateDependencies() {
        const errors = [];
        
        for (const [pluginName, plugin] of this.plugins) {
            const node = this.dependencyGraph.get(pluginName);
            
            for (const dep of node.dependencies) {
                const depPlugin = this.plugins.get(dep.name);
                if (!depPlugin) {
                    let versionReq = '';
                    if (dep.version) {
                        versionReq = ` (=${dep.version})`;
                    } else if (dep.minVersion || dep.maxVersion) {
                        versionReq = ' (';
                        if (dep.minVersion && dep.maxVersion) {
                            versionReq += `>=${dep.minVersion}, <=${dep.maxVersion}`;
                        } else if (dep.minVersion) {
                            versionReq += `>=${dep.minVersion}`;
                        } else if (dep.maxVersion) {
                            versionReq += `<=${dep.maxVersion}`;
                        }
                        versionReq += ')';
                    }
                    errors.push(`Plugin "${pluginName}" requires missing dependency "${dep.name}${versionReq}"`);
                    continue;
                }
                
                if (plugin.official && !depPlugin.official) {
                    errors.push(`Official plugin "${pluginName}" cannot depend on unofficial plugin "${dep.name}"`);
                    continue;
                }
                
                const versionCheck = this._checkDependencyVersion(depPlugin, dep);
                if (!versionCheck.compatible) {
                    errors.push(`Plugin "${pluginName}" dependency "${dep.name}" version incompatible: ${versionCheck.reason}`);
                }
            }
            
            for (const dep of node.optionalDependencies) {
                const depPlugin = this.plugins.get(dep.name);
                if (depPlugin) {
                    if (plugin.official && !depPlugin.official) {
                        errors.push(`Official plugin "${pluginName}" cannot have optional dependency on unofficial plugin "${dep.name}"`);
                        continue;
                    }
                    
                    // An optional dependency in the wrong version is just not
                    // usable - that must not stop the plugin itself loading.
                    const versionCheck = this._checkDependencyVersion(depPlugin, dep);
                    if (!versionCheck.compatible) {
                        console.warn(`Plugin "${pluginName}" optional dependency "${dep.name}" version incompatible (${versionCheck.reason}) - loading without it`);
                    }
                }
            }
        }
        
        return errors;
    }
    
    _checkDependencyVersion(depPlugin, requirement) {
        try {
            if (!requirement.version && !requirement.minVersion && !requirement.maxVersion) {
                return { compatible: true };
            }
            
            if (requirement.version) {
                const match = VersionUtils.compareVersions(depPlugin.version, requirement.version) === 0;
                if (!match) {
                    return {
                        compatible: false,
                        reason: `requires version ${requirement.version}, found ${depPlugin.version}`
                    };
                }
            }
            
            if (requirement.minVersion) {
                if (!VersionUtils.isCompatible(depPlugin.version, requirement.minVersion, 'min')) {
                    return {
                        compatible: false,
                        reason: `requires version >= ${requirement.minVersion}, found ${depPlugin.version}`
                    };
                }
            }
            
            if (requirement.maxVersion) {
                if (!VersionUtils.isCompatible(depPlugin.version, requirement.maxVersion, 'max')) {
                    return {
                        compatible: false,
                        reason: `requires version <= ${requirement.maxVersion}, found ${depPlugin.version}`
                    };
                }
            }
            
            return { compatible: true };
        } catch (error) {
            return {
                compatible: false,
                reason: `version check error: ${error.message}`
            };
        }
    }
    
    detectCircularDependencies() {
        const visiting = new Set();
        const visited = new Set();
        const cycles = [];
        
        const visit = (pluginName, path = []) => {
            if (visiting.has(pluginName)) {
                const cycleStart = path.indexOf(pluginName);
                cycles.push([...path.slice(cycleStart), pluginName]);
                return;
            }
            
            if (visited.has(pluginName)) {
                return;
            }
            
            visiting.add(pluginName);
            const node = this.dependencyGraph.get(pluginName);
            
            if (node) {
                for (const dep of node.dependencies) {
                    visit(dep.name, [...path, pluginName]);
                }
            }
            
            visiting.delete(pluginName);
            visited.add(pluginName);
        };
        
        for (const pluginName of this.plugins.keys()) {
            if (!visited.has(pluginName)) {
                visit(pluginName);
            }
        }
        
        return cycles;
    }
    
    getLoadOrder() {
        const visited = new Set();
        const loadOrder = [];
        
        const visit = (pluginName) => {
            if (visited.has(pluginName)) {
                return;
            }
            
            visited.add(pluginName);
            const node = this.dependencyGraph.get(pluginName);
            
            if (node) {
                for (const dep of node.dependencies) {
                    if (this.plugins.has(dep.name)) {
                        visit(dep.name);
                    }
                }
                
                for (const dep of node.optionalDependencies) {
                    if (this.plugins.has(dep.name)) {
                        visit(dep.name);
                    }
                }
            }
            
            loadOrder.push(pluginName);
        };
        
        const officialPlugins = [];
        const unofficialPlugins = [];
        
        for (const [pluginName, plugin] of this.plugins) {
            if (plugin.official) {
                officialPlugins.push(pluginName);
            } else {
                unofficialPlugins.push(pluginName);
            }
        }
        
        for (const pluginName of officialPlugins) {
            visit(pluginName);
        }
        
        for (const pluginName of unofficialPlugins) {
            visit(pluginName);
        }
        
        return loadOrder;
    }
    
    canDisablePlugin(pluginName, pluginStates) {
        const node = this.dependencyGraph.get(pluginName);
        if (!node) {
            return { canDisable: true };
        }
        
        const enabledDependents = [];
        for (const dependent of node.dependents) {
            const depNode = this.dependencyGraph.get(dependent);
            const dependentState = pluginStates ? pluginStates.get(dependent) : null;
            
            if (depNode && dependentState && dependentState.enabled) {
                const requiredDep = depNode.dependencies.find(dep => dep.name === pluginName);
                if (requiredDep) {
                    enabledDependents.push(dependent);
                }
            }
        }
        
        if (enabledDependents.length > 0) {
            return {
                canDisable: false,
                reason: `Plugin is required by enabled plugins: ${enabledDependents.join(', ')}`,
                dependents: enabledDependents
            };
        }
        
        return { canDisable: true };
    }
    
    getDependentsToDisable(pluginName) {
        const toDisable = new Set();
        const visited = new Set();
        
        const findDependents = (name) => {
            if (visited.has(name)) return;
            visited.add(name);
            
            const node = this.dependencyGraph.get(name);
            if (!node) return;
            
            for (const dependent of node.dependents) {
                const depNode = this.dependencyGraph.get(dependent);
                if (depNode) {
                    const hasRequiredDep = depNode.dependencies.some(dep => dep.name === name);
                    if (hasRequiredDep) {
                        toDisable.add(dependent);
                        findDependents(dependent);
                    }
                }
            }
        };
        
        findDependents(pluginName);
        return Array.from(toDisable);
    }
    
    getMissingDependencies(pluginName) {
        const node = this.dependencyGraph.get(pluginName);
        if (!node) return [];
        
        const missing = [];
        for (const dep of node.dependencies) {
            if (!this.plugins.has(dep.name)) {
                missing.push(dep.name);
            }
        }
        
        return missing;
    }
}

module.exports = { DependencyResolver };