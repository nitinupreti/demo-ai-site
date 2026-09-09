package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroLinkItemModel {

    @ValueMapValue
    private String label;

    @ValueMapValue
    private String link;

    public String getLabel() { return label; }
    public String getLink() { return link == null ? "#" : link; }
}