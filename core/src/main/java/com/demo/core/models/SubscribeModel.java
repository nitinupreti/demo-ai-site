/*
 * Sling Model for the subscribe (newsletter) component: heading + subtitle + email input + submit CTA.
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
public class SubscribeModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String subheading;

    @ValueMapValue
    private String placeholder;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String endpoint;

    @ValueMapValue
    private String background;

    @ValueMapValue
    private String backgroundHex;

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "furniture");
    }

    public String getHeading() {
        return heading;
    }

    public String getSubheading() {
        return subheading;
    }

    public String getPlaceholder() {
        return StringUtils.defaultIfBlank(placeholder, "Enter your email address");
    }

    public String getCtaLabel() {
        return StringUtils.defaultIfBlank(ctaLabel, "Submit");
    }

    public String getEndpoint() {
        return StringUtils.defaultIfBlank(endpoint, "#");
    }

    public String getBackgroundStyle() {
        if ("other".equals(background) && StringUtils.isNotBlank(backgroundHex)) {
            String hex = backgroundHex.trim();
            if (!hex.startsWith("#")) {
                hex = "#" + hex;
            }
            return "background-color: " + hex + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || StringUtils.isNotBlank(subheading);
    }
}
