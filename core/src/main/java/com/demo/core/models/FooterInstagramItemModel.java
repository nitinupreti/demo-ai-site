/*
 * Sling Model for a single footer Instagram tile.
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
public class FooterInstagramItemModel {

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String link;

    public String getImage() {
        return image;
    }

    public String getImageAlt() {
        return StringUtils.defaultIfBlank(imageAlt, "");
    }

    public String getLink() {
        return link;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(image);
    }
}
