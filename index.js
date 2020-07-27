'use strict';

function isAllowed(rule) {
    // Empty rule.
    if (rule.length === 0) {
        return false;
    }

    // Comment.
    if (rule.charAt(0) === '!') {
        return false;
    }

    // ASCII only.
    if (!(/^[\x00-\x7F]*$/.test(rule))) {
        return false;
    }

    // Not the introduction.
    if (rule.indexOf('[Adblock Plus') === 0) {
        return false;
    }

    // Unavailable resource type.
    if (rule.indexOf('\$') > 0) { // There is options
        var options = rule.substring(rule.indexOf('\$') + 1).split(',');
        var allowedResourceTypes = [ // No 'object' because iOS devices don't manage Java or Flash.
            'document', 'script', 'image', 'stylesheet', 'xmlhttprequest', 'subdocument',
            '~document', '~script', '~image', '~stylesheet', '~xmlhttprequest', '~object', '~object-subrequest', '~subdocument'
        ];
        var allowedResourceType;
        var ruleOnlyWithUnavailableResourceTypes = true;
        for (allowedResourceType in allowedResourceTypes) {
            if (options.indexOf(allowedResourceTypes[allowedResourceType]) > -1) {
                ruleOnlyWithUnavailableResourceTypes = false;
            }
        }
        if (ruleOnlyWithUnavailableResourceTypes && (options.indexOf('object') > -1 || options.indexOf('object-subrequest') > -1)) {
            return false;
        }
    }
    return true;
}

function getTrigger(rule) {
    var trigger = {};

    ////////////////////////////
    // Getting the URL filter //
    ////////////////////////////

    var urlFilter = rule;

    // Remove additional informations
    if (urlFilter.indexOf('$') > 0) {
        urlFilter = urlFilter.substring(0, urlFilter.indexOf('$'));
    }

    // Remove exception characters
    if (urlFilter.indexOf('@@') === 0) {
        urlFilter = urlFilter.substring(2);
    }

    // THE REST IS DONE IN SWIFT

    // Escape special regex characters
    urlFilter = urlFilter.replace(/[.$+?{}()\[\]\\]/g, '\\$&');

    // Separator character ^ matches anything but a letter, a digit, or one of the following: _ - . %.
    // The end of the address is also accepted as separator.
    urlFilter = urlFilter.replace(/\^/g, String.raw`[^a-z\-A-Z0-9._.%]`);

    // * symbol
    urlFilter = urlFilter.replace(/\*/g, '.*');

    // | in the end means the end of the address
    if (urlFilter.slice(-1) === '|') {
        urlFilter = urlFilter.slice(0, -1) + '$';
    }

    // || in the beginning means beginning of the domain name
    if (urlFilter.substring(0, 2) === '||') {
        if (urlFilter.length > 2) {
            urlFilter = String.raw`^(?:[^:]+:)(?://(?:[^/?#]*\.)?)` + urlFilter.slice(2);

        }
    } else if (urlFilter.charAt(0) === '|') { // | in the beginning means start of the address
        urlFilter = '^' + urlFilter.slice(1);
    }

    // other | symbols should be escaped, we have '|$' in our regexp - do not touch it
    urlFilter = urlFilter.replace(/\|/g, String.raw`\|`);

    trigger['url-filter'] = urlFilter;

    /////////////////////////
    // Getting the options //
    /////////////////////////

    if (rule.indexOf('\$') > 0) { // There is options
        var options = rule.substring(rule.indexOf('\$') + 1).split(',');
        var option;

        // Case sensitivity
        if (options.indexOf('match-case') > -1) {
            trigger['url-filter-is-case-sensitive'] = true;
        }

        // Resource types
        var allowedResourceTypes = [ // No 'object' because iOS devices don't manage Java or Flash.
            'document', 'script', 'image', 'stylesheet', 'xmlhttprequest', 'subdocument',
            '~document', '~script', '~image', '~stylesheet', '~xmlhttprequest', '~object', '~object-subrequest', '~subdocument'
        ];
        for (var allowedResourceType in allowedResourceTypes) {
            if (options.indexOf(allowedResourceTypes[allowedResourceType]) > -1) { // There is allowed resource types
                var resourceTypes = [];
                if (allowedResourceTypes[allowedResourceType].hasTidle()) { // IF the first allowed resource has a tidle, all the other will also have a tidle.
                    resourceTypes = ['document', 'script', 'image', 'style-sheet', 'raw', 'popup' /*, 'font', 'svg-document', 'media' */];
                    for (option in options) {
                        switch (options[option]) {
                            case '~document':
                            case '~script':
                            case '~image':
                                resourceTypes.splice(resourceTypes.indexOf(options[option].substring(1)), 1); // Remove the value from the array.
                                break;
                            case '~stylesheet':
                                resourceTypes.splice(resourceTypes.indexOf('style-sheet'), 1);
                                break;
                            case 'subdocument':
                                resourceTypes.splice(resourceTypes.indexOf('popup'), 1);
                                break;
                            case 'xmlhttprequest':
                                resourceTypes.splice(resourceTypes.indexOf('raw'), 1);
                                break;
                            default:
                                break;
                        }
                    }
                } else {
                    for (option in options) {
                        switch (options[option]) {
                            case 'document':
                            case 'script':
                            case 'image':
                                resourceTypes.push(options[option]);
                                break;
                            case 'stylesheet':
                                resourceTypes.push('style-sheet');
                                break;
                            case 'subdocument':
                                resourceTypes.push('popup'); // http://trac.webkit.org/browser/trunk/Source/WebCore/page/DOMWindow.cpp#L2149
                                break;
                            case 'xmlhttprequest':
                                resourceTypes.push('raw');
                                break;
                            // TODO : Add other cases
                            default:
                                break;
                        }
                    }
                }
                trigger['resource-type'] = resourceTypes;
            }
        }

        // Load type
        if (options.indexOf('third-party') > -1) {
            trigger['load-type'] = ['third-party'];
        } else if (options.indexOf('~third-party') > -1) {
            trigger['load-type'] = ['first-party'];
        }

        // Domains
        for (option in options) {
            if (options[option].indexOf('domain=') === 0) {
                var domains = options[option].substring('domain='.length).split('|')
                var unlessDomain = []
                var ifDomain = []
                var domain
                for (domain of domains) {
                    if (domain.hasTidle()) {
                        unlessDomain.push(addWildcard(domain.replace(/~/g, '')))
                    } else {
                        ifDomain.push(addWildcard(domain))
                    }
                }
                if (unlessDomain.length > 0) {
                    trigger['unless-domain'] = unlessDomain
                }
                if (ifDomain.length > 0) {
                    trigger['if-domain'] = ifDomain
                }
            }
        }
    }

    return trigger;
}

function getAction(rule) {
    if (rule.indexOf('@@') === 0) { // It is an exception
        return { 'type': 'ignore-previous-rules' };
    } else {
        return { 'type': 'block' };
    }
}

function getElementHidingTrigger(rule) {
    var trigger = {};
    var domains = rule.substring(0, rule.indexOf('##')).split(',');
    var domain;

    ////////////////////////////
    // Getting the URL filter //
    ////////////////////////////

    trigger['url-filter'] = '.*';

    ////////////////////////////////
    // Getting the rule's domains //
    ////////////////////////////////

    if (domains[0].length > 0) { // The rule has domains
        var ifDomains = [];
        var unlessDomains = [];

        for (domain in domains) {
            if (domains[domain].hasTidle()) {
                unlessDomains.push(domains[domain].slice(1));
            } else {
                ifDomains.push(domains[domain]);
            }
        }

        if (ifDomains.length > 0) {
            trigger['if-domain'] = ifDomains;
        }

        if (unlessDomains.length > 0) {
            trigger['unless-domain'] = unlessDomains;
        }
    }

    return trigger;
}

function getElementHidingAction(rule) {
    return { 'type': 'css-display-none', 'selector': rule.substring(rule.indexOf('##') + 2) };
}

function getKey(comment) {
    return {comment};
}

function getValue(comment) {
    return {comment};
}

/* Miscellaneous methods */
function addWildcard(e) {
    return '*' + e;
}

String.prototype.hasTidle = function() {
    if (this.substring(0, 1) === '~') {
        return true;
    }
    return false;
};

module.exports = {
    parseRules: function(rules) {
        var parsedRules = [];
        for (let rule of rules) {
            parsedRules = parsedRules.concat(this.parseRule(rule));
        } 
        return parsedRules;
    },
    parseRule: function(rule) {
        if (isAllowed(rule)) {
            var trigger;
            var action;
            if (rule.indexOf('##') === -1 && rule.indexOf('#@#') === -1) { // It is not element hiding
                trigger = getTrigger(rule);
                if (/^[ -~]+$/.test(trigger['url-filter'])) {
                    if (trigger['if-domain'] && trigger ['unless-domain']) {
                        delete trigger ['unless-domain']
                    }
                    return [{'trigger': trigger, 'action': getAction(rule)}];
                }
            } else { // It is element hiding
                var domain;
                if (rule.indexOf('#@#') !== -1) { // Exception rule syntax, we transform the rule for a standard syntax
                    var domains = rule.substring(0, rule.indexOf('#@#')).split(',');
                    var newDomains = [];
                    for (domain in domains) {
                        if (domains[domain].hasTidle()) {
                            newDomains.push(domains[domain].slice(1));
                        } else {
                            newDomains.push('~' + domains[domain]);
                        }
                    }
                    rule = newDomains.join() + '##' + rule.substring(rule.indexOf('#@#') + 3);
                }

                trigger = getElementHidingTrigger(rule);
                action = getElementHidingAction(rule);

                if (trigger['if-domain'] !== undefined && trigger['unless-domain'] !== undefined) { // if-domain + unless-domain = not possible!
                    if (trigger['if-domain'].length === 1) { // Only one if, we can manage that.
                        trigger['url-filter'] = String.raw`^(?:[^:/?#]+:)?(?://(?:[^/?#]*\.)?)?` + trigger['if-domain'][0].replace(/[.$+?{}()\[\]\\]/g, '\\$&') + String.raw`[^a-z\-A-Z0-9._.%]`;
                        delete trigger['if-domain'];
                        trigger['unless-domain'] = trigger['unless-domain'].map(addWildcard);
                        return [{'trigger': trigger, 'action': action}];
                    } else {
                        var rules = [];

                        var regularDomains = []; // Only if, no unless.

                        var ifDomains = trigger['if-domain'];
                        var unlessDomains = trigger['unless-domain'];
                        var ifDomain;
                        var unlessDomain;

                        for (ifDomain in ifDomains) {
                            var ifAndUnlessDomain = false;
                            for (unlessDomain in unlessDomains) {
                                if (unlessDomains[unlessDomain].indexOf(ifDomains[ifDomain]) > -1) {
                                    ifAndUnlessDomain = true;
                                }
                            }
                            if (ifAndUnlessDomain) { // There is an if and unless for this domain.
                                var ifUnlessDomains = [];
                                for (unlessDomain in unlessDomains) {
                                    if (unlessDomains[unlessDomain].indexOf(ifDomains[ifDomain]) > -1) {
                                        ifUnlessDomains.push(unlessDomains[unlessDomain]);
                                    }
                                }
                                var newRule = ifDomains[ifDomain] + ',~' + ifUnlessDomains.join(',~') + '##' + rule.substring(rule.indexOf('##') + 2);
                                rules.push(this.parseRule(newRule)[0]);
                            } else { // Only if for this domain.
                                regularDomains.push(ifDomains[ifDomain]);
                            }
                        }

                        var lastRule = regularDomains.join() + '##' + rule.substring(rule.indexOf('##') + 2);
                        rules.push(this.parseRule(lastRule)[0]);
                        return rules;
                    }
                } else {
                    if (trigger['if-domain'] !== undefined ) {
                        trigger['if-domain'] = trigger['if-domain'].map(addWildcard);
                    } else if (trigger['unless-domain'] !== undefined ) {
                        trigger['unless-domain'] = trigger['unless-domain'].map(addWildcard);
                    }
                    return [{'trigger': trigger, 'action': action}];
                }
            }
        }
        return [];
    }
};