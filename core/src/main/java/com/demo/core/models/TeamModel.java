/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TeamModel {

    @ChildResource
    private List<TeamMember> members;

    @ValueMapValue
    private String ctaText;

    @ValueMapValue @Default(values = "#")
    private String ctaLink;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        if (members == null) members = new ArrayList<>();
        members.removeIf(m -> m == null || !m.isHasContent());
        hasContent = !members.isEmpty();
    }

    public List<TeamMember> getMembers() { return Collections.unmodifiableList(members); }
    public String getCtaText() { return ctaText; }
    public String getCtaLink() { return ctaLink; }
    public boolean isHasContent() { return hasContent; }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class TeamMember {
        @ValueMapValue private String photo;
        @ValueMapValue private String name;
        @ValueMapValue private String role;
        @ValueMapValue private String bio;
        @ValueMapValue private String socialLink;

        public String getPhoto() { return photo; }
        public String getName() { return name; }
        public String getRole() { return role; }
        public String getBio() { return bio; }
        public String getSocialLink() { return socialLink; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(name);
        }
    }
}
