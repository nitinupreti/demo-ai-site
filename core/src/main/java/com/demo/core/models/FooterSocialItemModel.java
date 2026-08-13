/*
 * Sling Model for a single footer social-network link.
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FooterSocialItemModel {

    @ValueMapValue
    private String network;

    @ValueMapValue
    private String link;

    @ValueMapValue
    private String label;

    public String getNetwork() {
        return StringUtils.defaultIfBlank(network, "facebook");
    }

    public String getLink() {
        return StringUtils.defaultIfBlank(link, "#");
    }

    public String getLabel() {
        if (StringUtils.isNotBlank(label)) {
            return label;
        }
        String n = getNetwork();
        return "Follow us on " + Character.toUpperCase(n.charAt(0)) + n.substring(1);
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(network);
    }
}
