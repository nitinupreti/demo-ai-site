/*
 * Child model for a single header nav item.
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
public class NavItemModel {

    @ValueMapValue
    private String label;

    @ValueMapValue
    private String link;

    @ValueMapValue
    private Boolean active;

    public String getLabel() {
        return label;
    }

    public String getLink() {
        return StringUtils.defaultIfBlank(link, "#");
    }

    public boolean isActive() {
        return active != null && active.booleanValue();
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(label);
    }
}
