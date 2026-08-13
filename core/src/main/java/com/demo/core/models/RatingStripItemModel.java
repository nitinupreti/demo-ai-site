/*
 * Sling Model for a single rating-strip item.
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
public class RatingStripItemModel {

    @ValueMapValue
    private String icon;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    public String getIcon() {
        return StringUtils.defaultIfBlank(icon, "truck");
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title) || StringUtils.isNotBlank(description);
    }
}
