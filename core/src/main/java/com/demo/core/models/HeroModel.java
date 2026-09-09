package com.demo.core.models;

import java.util.Collections;
import java.util.List;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroModel {

    @ValueMapValue
    private String pretitle;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String titleAccent;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String primaryLabel;

    @ValueMapValue
    private String primaryLink;

    @ValueMapValue
    private String secondaryLabel;

    @ValueMapValue
    private String secondaryLink;

    @ValueMapValue
    private String brandName;

    @ValueMapValue
    private String loginLabel;

    @ValueMapValue
    private String loginLink;

    @ValueMapValue
    private String signupLabel;

    @ValueMapValue
    private String signupLink;

    @ChildResource
    private List<HeroLinkItemModel> navItems;

    @ChildResource
    private List<HeroStatusItemModel> statusItems;

    @ValueMapValue
    @Default(values = "teal")
    private String style;

    public String getPretitle() { return pretitle; }
    public String getTitle() { return title; }
    public String getTitleAccent() { return titleAccent; }
    public String getDescription() { return description; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt == null ? "" : imageAlt; }
    public String getPrimaryLabel() { return primaryLabel; }
    public String getPrimaryLink() { return primaryLink == null ? "#" : primaryLink; }
    public String getSecondaryLabel() { return secondaryLabel; }
    public String getSecondaryLink() { return secondaryLink == null ? "#" : secondaryLink; }
    public String getBrandName() { return brandName; }
    public String getLoginLabel() { return loginLabel; }
    public String getLoginLink() { return loginLink == null ? "#" : loginLink; }
    public String getSignupLabel() { return signupLabel; }
    public String getSignupLink() { return signupLink == null ? "#" : signupLink; }
    public List<HeroLinkItemModel> getNavItems() {
        return navItems == null ? Collections.emptyList() : Collections.unmodifiableList(navItems);
    }
    public List<HeroStatusItemModel> getStatusItems() {
        return statusItems == null ? Collections.emptyList() : Collections.unmodifiableList(statusItems);
    }
    public String getStyle() { return style; }

    public boolean isHasContent() {
        return (title != null && !title.isEmpty()) || (description != null && !description.isEmpty());
    }
}
