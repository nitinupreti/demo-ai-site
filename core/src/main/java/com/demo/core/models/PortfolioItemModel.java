/*
 * Sling Model for a single portfolio item (image with label).
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
public class PortfolioItemModel {

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String label;

    @ValueMapValue
    private String link;

    public String getImage() {
        return image;
    }

    public String getImageAlt() {
        return StringUtils.defaultIfBlank(imageAlt, "");
    }

    public String getLabel() {
        return label;
    }

    public String getLink() {
        return StringUtils.defaultIfBlank(link, "#");
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(image) || StringUtils.isNotBlank(label);
    }
}
