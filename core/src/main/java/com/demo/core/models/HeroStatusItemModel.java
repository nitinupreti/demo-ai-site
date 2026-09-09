package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroStatusItemModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String detail;

    @ValueMapValue
    private String actionLabel;

    public String getTitle() { return title; }
    public String getDetail() { return detail; }
    public String getActionLabel() { return actionLabel; }
}