package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class StatItemModel {

    @ValueMapValue
    private String value;

    @ValueMapValue
    private String label;

    public String getValue() { return value; }
    public String getLabel() { return label; }

    public boolean isHasContent() {
        return (value != null && !value.isEmpty()) || (label != null && !label.isEmpty());
    }
}
